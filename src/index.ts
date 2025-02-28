import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListResourcesRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import express, { Request, Response } from "express";  // Türleri ekledik
import axios from "axios";

const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY || "default-key";  // Render’da ortam değişkeni ile sağlanacak

const server = new Server(
  { name: "mcp-mistral-web", version: "1.0.0" },
  { capabilities: { resources: {} } }
);

// Kaynakları listele
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "file:///app/src/izahname.txt",
        name: "Izahname Document",
        description: "Web üzerinden soru-cevap için doküman",
        mimeType: "text/plain",
      },
    ],
  };
});

// Kaynak içeriğini oku
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === "file:///app/src/izahname.txt") {
    const content = await fs.readFile("src/izahname.txt", "utf-8");
    return { contents: [{ uri: request.params.uri, text: content }] };
  }
  throw new Error("Resource not found");
});

// HTTP Sunucusu
const app = express();
app.use(express.json());

// Soru-cevap endpoint’i (Mistral ile, Hugging Face üzerinden)
app.post("/ask", async (req: Request, res: Response) => {
  const question = req.body.question;
  try {
    const content = await fs.readFile("src/izahname.txt", "utf-8");
    const prompt = `Aşağıdaki dokümana dayanarak sorumu mümkün olduğunca net, doğru ve doküman içeriğine sadık bir şekilde yanıtla. Eğer dokümanda cevap yoksa, 'Dokümanda bu soruya yanıt bulunamadı' de. Doküman: ${content}\nSoru: ${question}\nCevap:`;

    const response = await axios.post(
      "https://api-inference.huggingface.co/models/mistralai/Mixtral-8x7B-Instruct-v0.1",
      { inputs: prompt, max_length: 300, temperature: 0.7 },
      {
        headers: {
          "Authorization": `Bearer ${HUGGINGFACE_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,  // 15 saniye timeout
      }
    );

    if (!response.data || !response.data[0] || !response.data[0].generated_text) {
      throw new Error("API yanıtında beklenen formatta veri yok");
    }

    const generatedText = response.data[0].generated_text.trim();
    const answer = generatedText.startsWith("Cevap:") ? generatedText.replace("Cevap:", "").trim() : generatedText;
    res.json({ answer });
  } catch (error: any) {
    console.error("Hata detayları:", error.message, error.stack);
    let errorMessage = "Cevap alınamadı";
    if (error.response) {
      errorMessage += `: API hatası - ${error.response.status} (${error.response.statusText}) - ${JSON.stringify(error.response.data)}`;
    } else if (error.request) {
      errorMessage += `: İstek gönderilemedi - ${error.message}`;
    } else {
      errorMessage += `: ${error.message}`;
    }
    res.status(500).json({ error: errorMessage });
  }
});

// Web sayfasını serve et
app.get("/", (req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head>
      <meta charset="UTF-8">
      <title>Izahname Dokümanına Soru-Cevap</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        textarea, button { width: 100%; margin: 10px 0; padding: 10px; }
        #answer { margin-top: 20px; padding: 10px; border: 1px solid #ccc; }
      </style>
    </head>
    <body>
      <h1>Izahname Dokümanına Soru Sor</h1>
      <textarea id="question" placeholder="Sorunuzu buraya yazın..."></textarea>
      <button onclick="ask()">Soruyu Gönder</button>
      <div id="answer"></div>
      <script>
        async function ask() {
          const question = document.getElementById("question").value;
          const response = await fetch("/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question }),
          });
          const data = await response.json();
          document.getElementById("answer").innerText = data.answer || "Cevap alınamadı.";
        }
      </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HTTP sunucusu ${PORT} portunda çalışıyor`));

// MCP Sunucusu
(async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.info('{"jsonrpc": "2.0", "method": "log", "params": { "message": "Server running..." }}');
})();
