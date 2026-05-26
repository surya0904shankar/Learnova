import { NextResponse } from "next/server";
import { connectDb } from "@/lib/mongodb";
import { withErrorHandler, authenticateRequest } from "@/lib/error-handler";

export const POST = withErrorHandler(async (req) => {
  const decodedToken = await authenticateRequest(req);

  const body = await req.json();
  const { category, subject, description, priority } = body;

  // Validation
  if (!category || !subject || !description || !priority) {
    return NextResponse.json(
      { message: "All fields are required" },
      { status: 400 }
    );
  }

  const db = await connectDb();

  await db.collection("complaints").insertOne({
    category,
    subject,
    description,
    priority,
    userId: decodedToken.uid,
    createdAt: new Date(),
  });

  return NextResponse.json(
    { message: "Complaint submitted successfully" },
    { status: 200 }
  );
});