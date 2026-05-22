import { db } from "@/lib/firebaseConfig";
import {
  collection,
  doc,
  getDoc,
  getCountFromServer,
  increment,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

export function getWeekdaysSinceYearStart() {
  const start = new Date(new Date().getFullYear(), 0, 1);
  const end = new Date();
  let weekdays = 0;

  for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
    const weekday = day.getDay();
    if (weekday >= 1 && weekday <= 5) {
      weekdays += 1;
    }
  }

  return Math.max(weekdays, 1);
}

/**
 * Initializes a new user's statistics document in Firestore with default zero values.
 * @param {string} userId - The unique ID of the user.
 * @returns {Promise<void>} Resolves when the stats document has been written.
 * @example
 * await initializeUserStats('user_abc123');
 * // Creates { 'Courses Enrolled': 0, 'Attendance Rate': '0%', ... } in Firestore
 */
export const initializeUserStats = async (userId) => {
  if (!userId) return;
  const statsRef = doc(db, "userStats", userId);
  
  const defaultStats = {
    "Courses Enrolled": 0,
    "Attendance Rate": "0%",
    "Assignments Done": 0,
    "Study Hours": 0,
    lastUpdated: new Date()
  };

  try {
    await setDoc(statsRef, defaultStats);
  } catch (error) {
    console.error("Error initializing stats:", error);
  }
};

/**
 * Increments a specific statistic field for a user in Firestore.
 * Creates the stats document first if it does not yet exist.
 * @param {string} userId - The unique ID of the user.
 * @param {string} statField - The stat field name (must match dashboard labels, e.g. 'Courses Enrolled').
 * @param {number} [value=1] - The amount to increment; can be negative to decrement.
 * @returns {Promise<void>} Resolves when the stat has been updated.
 * @example
 * await updateUserStat('user_abc123', 'Courses Enrolled', 1);
 * await updateUserStat('user_abc123', 'Study Hours', 2);
 */
export const updateUserStat = async (userId, statField, value = 1) => {
  if (!userId) return;
  const statsRef = doc(db, "userStats", userId);

  try {
    const statsSnap = await getDoc(statsRef);
    
    if (!statsSnap.exists()) {
      await initializeUserStats(userId);
    }

    await updateDoc(statsRef, {
      [statField]: increment(value),
      lastUpdated: new Date()
    });
  } catch (error) {
    console.error(`Error updating ${statField}:`, error);
  }
};

/**
 * Recomputes and persists a user's attendance rate as a percentage
 * based on their attendance_records relative to total weekdays since the start of the year.
 * @param {string} userId - The Firebase Auth user ID.
 * @returns {Promise<number|undefined>} The calculated attendance percentage (0–100), or undefined on early return.
 * @throws {Error} If the Firestore update fails.
 * @example
 * const rate = await recalculateAttendanceRate('user_abc123');
 * // rate is e.g. 87
 */
export const recalculateAttendanceRate = async (userId) => {
  if (!userId || !db) {
    return;
  }

  const statsRef = doc(db, "userStats", userId);
  const attendanceQuery = query(
    collection(db, "attendance_records"),
    where("userId", "==", userId)
  );

  try {
    const statsSnap = await getDoc(statsRef);
    if (!statsSnap.exists()) {
      await initializeUserStats(userId);
    }

    const countSnapshot = await getCountFromServer(attendanceQuery);
    const presentDays = countSnapshot.data().count;
    const totalDays = getWeekdaysSinceYearStart();
    const rate = Math.min(100, Math.round((presentDays / totalDays) * 100));

    await updateDoc(statsRef, {
      "Attendance Rate": `${rate}%`,
      attendancePresentDays: presentDays,
      lastUpdated: new Date(),
    });

    return rate;
  } catch (error) {
    console.error("Error recalculating attendance rate:", error);
    throw error;
  }
};

/**
 * Checks if a user's attendance rate is below 75% and sends an email alert using EmailJS.
 * Prevents spamming by checking `lastLowAttendanceAlertSentAt` (7-day cooldown).
 * @param {string} userId - The Firebase Auth user ID.
 * @param {string} studentName - The student's name.
 * @param {string} studentEmail - The student's email address.
 * @param {number} currentRate - The newly calculated attendance rate.
 * @returns {Promise<boolean>} True if an email was sent, false otherwise.
 */
export const checkAndSendAttendanceAlert = async (userId, studentName, studentEmail, currentRate) => {
  if (!userId || currentRate >= 75 || !studentEmail) return false;

  const statsRef = doc(db, "userStats", userId);
  
  try {
    const statsSnap = await getDoc(statsRef);
    if (!statsSnap.exists()) return false;

    const data = statsSnap.data();
    const lastAlertSentAt = data.lastLowAttendanceAlertSentAt?.toDate();

    // 7-day cooldown
    if (lastAlertSentAt) {
      const daysSinceLastAlert = (new Date() - lastAlertSentAt) / (1000 * 60 * 60 * 24);
      if (daysSinceLastAlert < 7) {
        return false;
      }
    }

    // Import emailjs dynamically or statically. Since this runs on client, we can dynamically import it to avoid bundle bloat
    const emailjs = (await import("@emailjs/browser")).default;

    // Send the email
    await emailjs.send(
      process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID,
      process.env.NEXT_PUBLIC_EMAILJS_ALERT_TEMPLATE_ID,
      {
        to_name: studentName,
        to_email: studentEmail,
        attendance_rate: currentRate,
        message: `Your current attendance rate has dropped to ${currentRate}%. Please ensure you attend future classes to maintain a healthy attendance record.`
      },
      process.env.NEXT_PUBLIC_EMAILJS_USER_ID
    );

    // Update the cooldown timestamp
    await updateDoc(statsRef, {
      lastLowAttendanceAlertSentAt: new Date(),
      lastUpdated: new Date(),
    });

    return true;
  } catch (error) {
    console.error("Error sending low attendance alert:", error);
    return false;
  }
};