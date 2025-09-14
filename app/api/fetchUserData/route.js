// app/api/fetchUserData/route.js
import { NextResponse } from "next/server";
import { db } from "../../../utils/db";
import { eq } from "drizzle-orm";
import { UserAnswer } from "../../../utils/schema";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ✅ Server-side only API key
const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("Missing GOOGLE_API_KEY environment variable.");
}

// Initialize Gemini AI client
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

export async function POST(request) {
  // 1️⃣ Check API key at runtime
  if (!genAI) {
    return NextResponse.json(
      { message: "Server configuration error: Missing API Key." },
      { status: 500 }
    );
  }

  // 2️⃣ Parse request body safely
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Invalid JSON in request body." },
      { status: 400 }
    );
  }

  const { userEmail } = body;
  if (!userEmail) {
    return NextResponse.json(
      { message: "userEmail is required in the request body." },
      { status: 400 }
    );
  }

  try {
    // 3️⃣ Fetch user answers from DB
    const userAnswers = await db
      .select()
      .from(UserAnswer)
      .where(eq(UserAnswer.userEmail, userEmail));

    console.log(`✅ Found ${userAnswers.length} answers for ${userEmail}`);

    if (!userAnswers || userAnswers.length === 0) {
      return NextResponse.json(
        { userAnswers: [], analysis: "No answers found to analyze." },
        { status: 200 }
      );
    }

    // 4️⃣ Build prompt for Gemini AI
    const answersText = userAnswers
      .map(
        (a, idx) =>
          `Question ${idx + 1}: "${a.question}"\nUser's Answer: "${a.userAns}"\nCorrect Answer Example: "${a.correctAns}"`
      )
      .join("\n\n");

    const prompt = `
      You are an expert interview coach reviewing a candidate's performance.
      Based on the following interview data, provide a concise, constructive, and encouraging analysis.
      Format your feedback in Markdown with:
      - **Overall Summary**
      - **Strengths** (1-2 bullets)
      - **Areas for Improvement** (1-2 bullets)

      Interview Data:
      ---
      ${answersText}
      ---
    `;

    console.log("📝 Sending prompt to Gemini AI...");

    // 5️⃣ Call Gemini safely
    let analysis = "";
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);

      analysis =
        result?.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";

      if (!analysis) {
        console.error("🤖 Gemini returned invalid content:", JSON.stringify(result, null, 2));
        return NextResponse.json(
          { message: "AI failed to generate a valid analysis. Content might be blocked." },
          { status: 500 }
        );
      }
    } catch (aiErr) {
      console.error("🔥 Gemini API call failed:", aiErr);
      return NextResponse.json(
        { message: "AI generation error", error: aiErr?.message || String(aiErr) },
        { status: 500 }
      );
    }

    // 6️⃣ Return successful response
    return NextResponse.json(
      {
        userAnswers,
        analysis,
      },
      { status: 200 }
    );

  } catch (err) {
    console.error("🔥 API error:", err);
    return NextResponse.json(
      {
        message: "Internal server error",
        error: err?.message || String(err),
        stack: process.env.NODE_ENV === "development" ? err?.stack : undefined,
      },
      { status: 500 }
    );
  }
}
