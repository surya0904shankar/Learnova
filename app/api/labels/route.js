import { connectDb } from "@/lib/mongodb";

import {
  jsonSuccess,
  jsonError,
} from "@/lib/api-response";

import { verifyFirebaseToken } from "@/lib/firebase-admin";

export const rateLimitMap = new Map();

const RATE_LIMIT_WINDOW =
  60 * 1000;

const MAX_ATTEMPTS = 10;

export async function GET(
  request
) {
  try {
    // Rate limiting
    const ip =
      request.headers.get(
        "x-real-ip"
      ) ||
      request.headers.get(
        "x-vercel-proxied-for"
      ) ||
      request.ip ||
      request.headers
        .get(
          "x-forwarded-for"
        )
        ?.split(",")[0]
        ?.trim() ||
      "127.0.0.1";

    const now = Date.now();

    if (!rateLimitMap.has(ip)) {
      rateLimitMap.set(ip, []);
    }

    const attempts =
      rateLimitMap
        .get(ip)
        .filter(
          (timestamp) =>
            now - timestamp <
            RATE_LIMIT_WINDOW
        );

    attempts.push(now);

    rateLimitMap.set(
      ip,
      attempts
    );

    if (
      attempts.length >
      MAX_ATTEMPTS
    ) {
      return jsonError(
        "Too many attempts. Please try again later.",
        429
      );
    }

    // Authentication
    const authorization =
      request.headers.get(
        "authorization"
      );

    const token =
      authorization?.split(
        " "
      )[1];

    if (!token) {
      return jsonError(
        "Unauthorized: No token provided",
        401
      );
    }

    const authResult =
      await verifyFirebaseToken(
        token
      );

    if (!authResult.valid) {
      return jsonError(
        {
          message:
            "Unauthorized",

          reason:
            authResult.reason,
        },
        401
      );
    }

    // Search query
    const { searchParams } =
      new URL(request.url);

    const search =
      searchParams.get(
        "search"
      );

    const query = search
      ? {
          $or: [
            {
              name: {
                $regex:
                  search,

                $options:
                  "i",
              },
            },

            {
              email: {
                $regex:
                  search,

                $options:
                  "i",
              },
            },
          ],
        }
      : {};

    // Database
    const db =
      await connectDb();

    const users =
      db.collection("users");

    const allUsers =
      await users
        .find(query, {
          projection: {
            _id: 1,
            name: 1,
            email: 1,
            image: 1,
          },
        })
        .limit(50)
        .toArray();

    const sanitizedUsers =
      allUsers.map(
        ({
          image,
          ...rest
        }) => ({
          ...rest,
          hasImage:
            !!image,
        })
      );

    return jsonSuccess(
      sanitizedUsers,
      200
    );
  } catch (err) {
    console.error(err);

    return jsonError(
      "Failed to fetch labels",
      500
    );
  }
}
