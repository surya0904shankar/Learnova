"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import * as faceapi from "face-api.js";

import { Button } from "@/components/ui/button";

import useLabels from "@/components/useLabels";

import { recordAttendance } from "@/services/attendanceService";

import { analytics } from "@/lib/firebaseConfig";

import { logEvent } from "firebase/analytics";

const MIN_CONFIDENCE_TO_RECORD =
  60;

export default function FaceRecognizer({
  authUser,
}) {
  const isMounted =
    useRef(true);

  const retryStreamRef =
    useRef(null);

  const videoRef =
    useRef(null);

  const canvasRef =
    useRef(null);

  const cachedDescriptorsRef =
    useRef(null);

  const faceMatcherRef =
    useRef(null);

  const {
    labels: fetchedLabels,
    loading: labelsLoading,
    error,
  } = useLabels(authUser);

  const [message, setMessage] =
    useState(
      "Loading models..."
    );

  const [finished, setFinished] =
    useState(false);

  const [
    detectedPerson,
    setDetectedPerson,
  ] = useState(null);

  const [isLoading, setIsLoading] =
    useState(true);

  const [confidence, setConfidence] =
    useState(0);

  const [
    attendanceState,
    setAttendanceState,
  ] = useState("idle");

  const MODEL_URL = "/models";

  const labels =
    fetchedLabels;

  const handleRetry =
    async () => {
      try {
        if (
          retryStreamRef.current
        ) {
          retryStreamRef.current
            .getTracks()
            .forEach((t) =>
              t.stop()
            );
        }

        const stream =
          await navigator.mediaDevices.getUserMedia(
            {
              video: {},
            }
          );

        retryStreamRef.current =
          stream;

        if (videoRef.current) {
          videoRef.current.srcObject =
            stream;

          videoRef.current.onloadedmetadata =
            () => {
              videoRef.current.play();

              setIsLoading(false);

              matchCurrentFrame();
            };
        }

        setMessage(
          "Camera access granted ✅"
        );

        setFinished(false);

        setAttendanceState(
          "idle"
        );
      } catch (err) {
        if (
          err.name ===
          "NotAllowedError"
        ) {
          setMessage(
            "Camera access is blocked! Enable camera permissions in browser settings."
          );
        } else {
          setMessage(
            "Cannot access camera ❌"
          );
        }

        setFinished(true);
      }
    };

  useEffect(() => {
    let stream;

    const loadModels =
      async () => {
        try {
          await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(
              MODEL_URL
            ),

            faceapi.nets.faceLandmark68Net.loadFromUri(
              MODEL_URL
            ),

            faceapi.nets.faceRecognitionNet.loadFromUri(
              MODEL_URL
            ),
          ]);

          setMessage(
            "Models loaded ✅ Starting webcam..."
          );

          startVideo();
        } catch (err) {
          setMessage(
            "Failed to load models."
          );

          setIsLoading(false);

          setFinished(true);
        }
      };

    const startVideo =
      async () => {
        try {
          stream =
            await navigator.mediaDevices.getUserMedia(
              {
                video: {},
              }
            );

          if (
            videoRef.current
          ) {
            videoRef.current.srcObject =
              stream;

            videoRef.current.onloadedmetadata =
              () => {
                videoRef.current.play();

                setIsLoading(
                  false
                );

                setMessage(
                  "Building face models..."
                );

                buildFaceMatcher().then(
                  () => {
                    setMessage(
                      "Looking for faces..."
                    );

                    matchCurrentFrame();
                  }
                );
              };
          }
        } catch (err) {
          setMessage(
            "Cannot access webcam ❌"
          );

          setFinished(true);

          setIsLoading(false);
        }
      };

    if (
      !labelsLoading &&
      !error &&
      labels.length > 0
    ) {
      loadModels();
    }

    return () => {
      isMounted.current =
        false;

      if (
        retryStreamRef.current
      ) {
        retryStreamRef.current
          .getTracks()
          .forEach((t) =>
            t.stop()
          );

        retryStreamRef.current =
          null;
      }

      if (stream) {
        stream
          .getTracks()
          .forEach((track) =>
            track.stop()
          );
      }

      if (videoRef.current) {
        videoRef.current.srcObject =
          null;
      }
    };
  }, [
    labelsLoading,
    error,
    labels,
  ]);

  const buildFaceMatcher =
    async () => {
      if (
        !labels ||
        labels.length === 0
      ) {
        return;
      }

      const labeledFaceDescriptors =
        (
          await Promise.all(
            labels.map(
              async (
                student
              ) => {
                try {
                  const img =
                    await faceapi.fetchImage(
                      student.image
                    );

                  const detection =
                    await faceapi
                      .detectSingleFace(
                        img,
                        new faceapi.TinyFaceDetectorOptions()
                      )
                      .withFaceLandmarks()
                      .withFaceDescriptor();

                  if (
                    detection
                  ) {
                    return new faceapi.LabeledFaceDescriptors(
                      student.name,
                      [
                        detection.descriptor,
                      ]
                    );
                  }

                  return null;
                } catch (err) {
                  console.error(
                    "Face descriptor error:",
                    err
                  );

                  return null;
                }
              }
            )
          )
        ).filter(Boolean);

      cachedDescriptorsRef.current =
        labeledFaceDescriptors;

      if (
        !labeledFaceDescriptors.length
      ) {
        if (
          isMounted.current
        ) {
          setMessage(
            "No labeled faces found ❌"
          );

          setFinished(true);
        }

        return;
      }

      faceMatcherRef.current =
        new faceapi.FaceMatcher(
          labeledFaceDescriptors,
          0.6
        );
    };

  const matchCurrentFrame =
    async () => {
      if (
        !videoRef.current ||
        !canvasRef.current ||
        !faceMatcherRef.current
      ) {
        return;
      }

      const video =
        videoRef.current;

      const canvas =
        canvasRef.current;

      const displaySize = {
        width:
          video.videoWidth ||
          720,

        height:
          video.videoHeight ||
          500,
      };

      canvas.width =
        displaySize.width;

      canvas.height =
        displaySize.height;

      faceapi.matchDimensions(
        canvas,
        displaySize
      );

      const detections =
        await faceapi
          .detectAllFaces(
            video,
            new faceapi.TinyFaceDetectorOptions()
          )
          .withFaceLandmarks()
          .withFaceDescriptors();

      const resizedDetections =
        faceapi.resizeResults(
          detections,
          displaySize
        );

      const ctx =
        canvas.getContext("2d");

      if (!ctx) return;

      ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );

      if (
        resizedDetections.length >
        0
      ) {
        const face =
          resizedDetections[0];

        const bestMatch =
          faceMatcherRef.current.findBestMatch(
            face.descriptor
          );

        const label =
          bestMatch.label ===
          "unknown"
            ? "Unknown"
            : bestMatch.label;

        const confidenceScore =
          Math.round(
            (1 -
              bestMatch.distance) *
              100
          );

        const box =
          face.detection.box;

        ctx.strokeStyle =
          label !== "Unknown"
            ? "#10b981"
            : "#ef4444";

        ctx.lineWidth = 3;

        ctx.strokeRect(
          box.x,
          box.y,
          box.width,
          box.height
        );

        ctx.fillStyle =
          label !== "Unknown"
            ? "#10b981"
            : "#ef4444";

        ctx.fillRect(
          box.x,
          box.y - 30,
          box.width,
          30
        );

        ctx.fillStyle =
          "white";

        ctx.font =
          "16px Inter, sans-serif";

        ctx.textAlign =
          "center";

        ctx.fillText(
          `${label} (${confidenceScore}%)`,
          box.x +
            box.width / 2,
          box.y - 8
        );

        setMessage(
          `Detected: ${label}`
        );

        setConfidence(
          confidenceScore
        );

        if (
          label !== "Unknown"
        ) {
          const person =
            labels.find(
              (l) =>
                l.name ===
                label
            );

          setDetectedPerson(
            person || null
          );
        } else {
          setDetectedPerson(
            null
          );
        }
      } else {
        if (
          isMounted.current
        ) {
          setMessage(
            "No face detected"
          );

          setDetectedPerson(
            null
          );

          setConfidence(0);
        }
      }

      if (
        isMounted.current
      ) {
        setFinished(true);
      }
    };

  useEffect(() => {
    if (analytics) {
      logEvent(
        analytics,
        "page_view",
        {
          page:
            "attendance",
        }
      );
    }
  }, []);

  useEffect(() => {
    const persistAttendance =
      async () => {
        if (
          !finished ||
          !detectedPerson ||
          !authUser?.uid
        ) {
          return;
        }

        if (
          confidence <
          MIN_CONFIDENCE_TO_RECORD
        ) {
          setAttendanceState(
            "low-confidence"
          );

          return;
        }

        const detectedEmail =
          detectedPerson.email
            ?.trim()
            .toLowerCase();

        const userEmail =
          authUser.email
            ?.trim()
            .toLowerCase();

        if (
          detectedEmail &&
          userEmail &&
          detectedEmail !==
            userEmail
        ) {
          setAttendanceState(
            "mismatch"
          );

          setMessage(
            "Face does not match signed-in account."
          );

          return;
        }

        setAttendanceState(
          "saving"
        );

        try {
          const result =
            await recordAttendance(
              {
                userId:
                  authUser.uid,

                studentName:
                  detectedPerson.name,

                email:
                  detectedPerson.email ||
                  authUser.email,

                confidenceScore:
                  confidence,
              }
            );

          setAttendanceState(
            result.alreadyRecorded
              ? "already-recorded"
              : "saved"
          );
        } catch (err) {
          setAttendanceState(
            "error"
          );

          setMessage(
            err.message ||
              "Could not save attendance."
          );
        }
      };

    persistAttendance();
  }, [
    authUser,
    confidence,
    detectedPerson,
    finished,
  ]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white">
      <video
        ref={videoRef}
        autoPlay
        muted
        className="w-full max-w-4xl rounded-xl"
      />

      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0"
      />

      <p className="mt-4 text-lg">
        {message}
      </p>

      {confidence > 0 && (
        <p className="text-sm text-purple-400">
          Confidence:
          {" "}
          {confidence}%
        </p>
      )}

      {detectedPerson && (
        <div className="mt-4 text-center">
          <h2 className="text-2xl font-bold">
            {
              detectedPerson.name
            }
          </h2>

          <p>
            {
              detectedPerson.email
            }
          </p>
        </div>
      )}

      {finished && (
        <Button
          onClick={
            handleRetry
          }
          className="mt-6"
        >
          Scan Again
        </Button>
      )}
    </div>
  );
}
