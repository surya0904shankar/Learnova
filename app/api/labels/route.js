import { connectDb } from "@/lib/mongodb";
import { verifyFirebaseToken } from "@/lib/firebase-admin";
import { jsonError, jsonSuccess } from "@/lib/api-response";

export async function GET(request) {
  try {
    const authorization = request.headers.get("authorization");
    const token = authorization?.split(" ")[1];

    const decodedToken = await verifyFirebaseToken(token);

    if (!decodedToken) {
      return jsonError("Unauthorized", 401);
    }

    const db = await connectDb();
    const users = db.collection("users");

    const allUsers = await users
      .find({}, { projection: { _id: 0 } })
      .toArray();

    return jsonSuccess(allUsers, 200);
  } catch (err) {
    console.error("❌ Error fetching labels:", err);
    return jsonError("Failed to fetch labels", 500);
  }
}
