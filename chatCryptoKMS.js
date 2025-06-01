// chatCryptoKMS.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { KeyManagementServiceClient } = require('@google-cloud/kms').v1;

if (!admin.apps.length) {
  admin.initializeApp();
}

const kmsClient = new KeyManagementServiceClient();
let validatedKmsKeyPath;

async function getAndValidateKmsKeyPath() {
  if (validatedKmsKeyPath) {
    return validatedKmsKeyPath;
  }
  // KEYRING_SECRET_PATH_ENV es la variable de entorno que configuras con --set-secrets
  // y contendrá directamente la ruta de tu clave KMS (el valor del secreto).
  const keyPathFromEnv = process.env.KEYRING_SECRET_PATH_ENV;
  if (!keyPathFromEnv) {
    console.error('Environment variable "KEYRING_SECRET_PATH_ENV" is not set or empty.');
    throw new functions.https.HttpsError('internal', 'Server configuration error: KMS key path environment variable missing.');
  }
  const keyPath = keyPathFromEnv.trim();
  if (!keyPath.includes('/keyRings/') || !keyPath.includes('/cryptoKeys/') || !keyPath.includes('/cryptoKeyVersions/')) {
    console.error('Env var "KEYRING_SECRET_PATH_ENV" does not appear to hold a valid KMS CryptoKeyVersion path:', keyPath);
    throw new Error('Invalid KMS CryptoKeyVersion path format provided in "KEYRING_SECRET_PATH_ENV".');
  }
  validatedKmsKeyPath = keyPath;
  console.log(`KMS CryptoKeyVersion Path to be used: ${validatedKmsKeyPath}`);
  return validatedKmsKeyPath;
}

// MODIFICACIÓN CLAVE: Eliminar .runWith()
exports.encryptChatMessage = functions.https.onRequest(async (req, res) => {
  // Configuración CORS
  const allowedOrigins = [ 'http://localhost:5173', 'https://saas-stream-react-gcp.web.app', 'https://saas-stream-react-gcp.firebaseapp.com'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const idToken = req.headers.authorization?.split('Bearer ')[1];
  // En un entorno de producción real, siempre deberías verificar el token.
  // Para pruebas locales con el emulador, podrías tener una condición para saltar esto.
  if (!idToken && process.env.FUNCTIONS_EMULATOR !== 'true') { 
     console.warn('encryptChatMessage: No ID token provided.');
     res.status(401).send('Unauthorized: Missing Firebase ID Token.');
     return;
  }
  try {
    // Solo verifica si hay token y no estamos en el emulador sin token
    if (idToken) await admin.auth().verifyIdToken(idToken); 
  } catch (error) {
    console.error('encryptChatMessage: Invalid Firebase ID Token:', error);
    res.status(401).send('Unauthorized: Invalid Firebase ID Token.');
    return;
  }

  const { plaintext } = req.body;
  if (!plaintext || typeof plaintext !== 'string') {
    res.status(400).json({ error: 'Missing or invalid "plaintext" in request body.' });
    return;
  }
  try {
    const activeKeyPath = await getAndValidateKmsKeyPath(); 
    const plaintextBuffer = Buffer.from(plaintext);
    const [encryptResponse] = await kmsClient.encrypt({
      name: activeKeyPath,
      plaintext: plaintextBuffer,
    });
    if (!encryptResponse.ciphertext) {
      throw new Error('KMS encryption did not return ciphertext.');
    }
    const ciphertext = encryptResponse.ciphertext.toString('base64');
    res.status(200).json({
      ciphertext: ciphertext,
      kmsKeyVersionName: encryptResponse.name
    });
  } catch (error) {
    console.error('KMS Encryption Error:', error.message, error.code ? `(Code: ${error.code})` : '');
    if (error instanceof functions.https.HttpsError || (error.httpErrorCode && error.httpErrorCode.status)) {
        const status = error.httpErrorCode ? error.httpErrorCode.status : 500;
        res.status(status).json({ error: error.message });
    } else if (error.code) { // Errores del cliente KMS
        res.status(500).json({ error: `KMS Client Error: ${error.message} (Code: ${error.code})` });
    } else {
        res.status(500).json({ error: `Failed to encrypt message. ${error.message || 'Unknown internal error'}` });
    }
  }
});

// MODIFICACIÓN CLAVE: Eliminar .runWith()
exports.decryptChatMessage = functions.https.onRequest(async (req, res) => {
  // --- Inicio: Configuración CORS y manejo de OPTIONS (permanece igual) ---
  const allowedOrigins = [ 'http://localhost:5173', 'https://saas-stream-react-gcp.web.app', 'https://saas-stream-react-gcp.firebaseapp.com'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    res.status(204).send('');
    return;
  }
  
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  // --- Fin: Configuración CORS y manejo de OPTIONS ---

  // --- Inicio: Verificación de Autenticación (permanece igual) ---
  const idToken = req.headers.authorization?.split('Bearer ')[1];
  if (!idToken && process.env.FUNCTIONS_EMULATOR !== 'true') { // Ajusta si no usas emulador
     console.warn('decryptChatMessage: No ID token provided.');
     res.status(401).send('Unauthorized: Missing Firebase ID Token.');
     return;
  }
  try {
    if (idToken) await admin.auth().verifyIdToken(idToken);
  } catch (error) {
    console.error('decryptChatMessage: Invalid Firebase ID Token:', error);
    res.status(401).send('Unauthorized: Invalid Firebase ID Token.');
    return;
  }
  // --- Fin: Verificación de Autenticación ---

  const { ciphertext, kmsKeyVersionName } = req.body; // kmsKeyVersionName es 'projects/.../cryptoKeyVersions/1'

  if (!ciphertext || typeof ciphertext !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "ciphertext" in request body.' });
  }
  if (!kmsKeyVersionName || typeof kmsKeyVersionName !== 'string' || !kmsKeyVersionName.includes('/cryptoKeyVersions/')) {
    console.error("Invalid kmsKeyVersionName format received:", kmsKeyVersionName);
    return res.status(400).json({ error: "Invalid or missing kmsKeyVersionName format." });
  }

  try {
    // ***** INICIO DE LA MODIFICACIÓN IMPORTANTE *****
    // Derivar la ruta de la CryptoKey padre desde la CryptoKeyVersion
    // Ejemplo: projects/P/locations/L/keyRings/R/cryptoKeys/K/cryptoKeyVersions/V
    // Necesitamos la parte "projects/P/locations/L/keyRings/R/cryptoKeys/K"
    const cryptoKeyPathForDecrypt = kmsKeyVersionName.substring(0, kmsKeyVersionName.lastIndexOf('/cryptoKeyVersions/'));
    
    console.log(`Derived CryptoKey path for decryption API call: ${cryptoKeyPathForDecrypt}`);
    console.log(`Full CryptoKeyVersion path used for encryption (from client): ${kmsKeyVersionName}`);
    // ***** FIN DE LA MODIFICACIÓN IMPORTANTE *****

    const ciphertextBuffer = Buffer.from(ciphertext, 'base64');
    const [decryptResponse] = await kmsClient.decrypt({
      name: cryptoKeyPathForDecrypt, // <--- Usar la ruta de la CryptoKey padre
      ciphertext: ciphertextBuffer,
    });

    if (!decryptResponse.plaintext) {
      throw new Error('KMS decryption did not return plaintext.');
    }
    
    // Opcional: Verificar si la versión que KMS usó para descifrar coincide con la original.
    // KMS debería hacerlo automáticamente basado en los metadatos del ciphertext.
    console.log(`KMS reported using key version: ${decryptResponse.cryptoKeyVersion} for decryption.`);
    if (decryptResponse.cryptoKeyVersion !== kmsKeyVersionName) {
        console.warn(`Decryption used key version ${decryptResponse.cryptoKeyVersion}, but original encryption was with ${kmsKeyVersionName}. This is normal if the key was rotated and original version still active.`);
    }

    const plaintext = decryptResponse.plaintext.toString('utf8');
    res.status(200).json({ plaintext: plaintext });

  } catch (error) {
    console.error('KMS Decryption Error:', error.message, error.code ? `(Code: ${error.code})` : '', error.details || '');
    if (error.code === 3) { // INVALID_ARGUMENT
        return res.status(400).json({ error: `KMS Decryption Invalid Argument: ${error.message}. Used CryptoKey path: ${kmsKeyVersionName.substring(0, kmsKeyVersionName.lastIndexOf('/cryptoKeyVersions/'))}` });
    }
    res.status(500).json({ error: `Failed to decrypt message. ${error.message || 'Unknown internal error'}` });
  }
});