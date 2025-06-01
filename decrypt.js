require('dotenv').config();
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const crypto = require('crypto');

const client = new SecretManagerServiceClient();
const secretName = "projects/72423280062/secrets/chat-encryption-key/versions/latest"; // Adjust

const GEMINI_CLOUD_FUNCTION_URL = process.env.GEMINI_CLOUD_FUNCTION_URL; // URL of your Gemini function

// Function to access the secret from Secret Manager
const accessSecretVersion = async () => {
  try {
    const [version] = await client.accessSecretVersion({ name: secretName });
    return version.payload.data.toString();
  } catch (error) {
    console.error("Error accessing secret:", error);
    throw new Error("Failed to access encryption key");
  }
};

exports.decryptAndProcess = async (req, res) => {
  try {
    const encryptionKey = await accessSecretVersion();
    const encryptedData = req.body.encryptedPrompt;

    // **DESENCRIPTAR**
    const iv = Buffer.from(encryptedData.iv.split(',').map(Number));
    const data = Buffer.from(encryptedData.data.split(',').map(Number));
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'base64'), iv);
    let decryptedText = decipher.update(data, 'binary', 'utf8');
    decryptedText += decipher.final('utf8');

    // **LLAMAR A LA CLOUD FUNCTION DE GEMINI**
    const geminiResponse = await fetch(GEMINI_CLOUD_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: decryptedText })
    });

    if (!geminiResponse.ok) {
      throw new Error(`Gemini function error: ${geminiResponse.statusText}`);
    }

    const geminiData = await geminiResponse.json();
    const botResponse = geminiData.response;

    // **ENCRIPTAR LA RESPUESTA**
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'base64'), iv); // Use the same IV!
    let encryptedResponse = cipher.update(botResponse, 'utf8', 'binary');
    encryptedResponse += cipher.final('binary');

    const encryptedResponseData = {
      iv: Array.from(iv).join(','),
      data: Array.from(new Uint8Array(encryptedResponse)).join(',')
    };

    res.json({ encryptedResponse: encryptedResponseData });

  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).send("Server error");
  }
};