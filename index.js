//require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const chatCryptoFunctions = require('./chatCryptoKMS'); // Asegúrate que la ruta sea correcta


exports.encryptChatMessage = chatCryptoFunctions.encryptChatMessage;
exports.decryptChatMessage = chatCryptoFunctions.decryptChatMessage;

const ai = new GoogleGenAI({
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT_ID,
  location: 'us-central1'
});
const model = 'gemini-2.0-flash-001';

const generationConfig = {
  maxOutputTokens: 8192,
  temperature: 1,
  topP: 0.95,
  responseModalities: ["TEXT"],
  safetySettings: [
    {
      category: 'HARM_CATEGORY_HATE_SPEECH',
      threshold: 'OFF',
    },
    {
      category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
      threshold: 'OFF',
    },
    {
      category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      threshold: 'OFF',
    },
    {
      category: 'HARM_CATEGORY_HARASSMENT',
      threshold: 'OFF',
    }
  ],
};

exports.generateGeminiResponse = async (req, res) => {
  const allowedOrigins = [
    'http://localhost:5173',
    'https://saas-stream-react-gcp.web.app',
    'https://saas-stream-react-gcp.firebaseapp.com' 
    ];
    
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
  res.set('Access-Control-Allow-Origin', origin);
  }
 
 // 2. Permite que el navegador envíe credenciales (cookies, encabezados de Authorization)
 res.set('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.status(204).send(''); 
    return;
  }

  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt in request body' });
    }

    const reqData = {
      model: model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: generationConfig,
    };

    const response = await ai.models.generateContent(reqData);
    console.log("Respuesta completa de Gemini:", JSON.stringify(response, null, 2)); // Añade esta línea
    const text = response?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (text) {
      res.status(200).json({ response: text });
    } else {
      res.status(500).json({ error: 'No response from Gemini' });
    }

  } catch (error) {
    console.error('Error generating content:', error);
    res.status(500).json({ error: 'Failed to generate response' });
  }
};