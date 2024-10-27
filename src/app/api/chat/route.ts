import { GoogleGenerativeAI } from "@google/generative-ai";
import { Message } from "ai";
import { getContext } from "@/lib/context";
import { db } from "@/lib/db";
import { chats, messages as _messages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: Request) {
  try {
    const { messages, chatId } = await req.json();
    const _chats = await db.select().from(chats).where(eq(chats.id, chatId));

    if (_chats.length != 1) {
      return NextResponse.json({ error: "chat not found" }, { status: 404 });
    }

    const fileKey = _chats[0].fileKey;
    const lastMessage = messages[messages.length - 1];
    const context = await getContext(lastMessage.content, fileKey);

    // Create the system prompt with context
    const systemPrompt = `You are an AI legal assistant, expertly trained in analyzing and summarizing legal documents. Your primary functions are:

1. Interpreting legal language and explaining it in clear, concise terms.
2. Summarizing legal documents while retaining all crucial information.
3. Answering questions about legal documents based on their content.
4. Identifying key clauses, terms, and potential issues in legal texts.
5. Providing general legal information (but not specific legal advice).

When responding:
- Always base your answers on the provided context from the legal documents.
- Dont mention based from context or any other related terms in your answers.
- If the context doesn't contain the necessary information, state: "I'm sorry, but I don't have enough information in the provided context to answer that question accurately."
- Avoid making assumptions or inventing information not present in the given context.
- Use clear, professional language, but explain legal terms when necessary.
- When summarizing, focus on the most important points, obligations, rights, and potential risks.
- If asked about specific legal advice, remind the user that you're an AI assistant and recommend consulting with a qualified legal professional.

START CONTEXT BLOCK
${context}
END OF CONTEXT BLOCK

Remember to analyze the CONTEXT BLOCK carefully for each query, as it contains the relevant legal document information for the user's questions.`;
    // Format chat history for Gemini
    const chatHistory = messages.map((message: Message) => ({
      role: message.role === "user" ? "user" : "model",
      parts: [{ text: message.content }],
    }));

    // Initialize the model
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Start a chat session
    const chat = model.startChat({
      history: chatHistory,
      generationConfig: {
        maxOutputTokens: 3000,
      },
    });

    // Generate response
    const result = await chat.sendMessage([
      { text: systemPrompt + "\n\n" + lastMessage.content },
    ]);
    const aiResponse = result.response.text();

    // Save the user message to the database
    await db.insert(_messages).values({
      chatId,
      content: lastMessage.content,
      role: "user",
    });

    // Save the AI response to the database
    await db.insert(_messages).values({
      chatId,
      content: aiResponse,
      role: "system",
    });

    return NextResponse.json({ response: aiResponse });
  } catch (error) {
    console.error("Error in chat route:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
