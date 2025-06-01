
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Esta función ya no se usa en el cliente.  La lógica de generación de claves
// debe estar en el servidor.  La dejo aquí como referencia.
export async function generateKey(password) {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  
  return await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptData(key, data) {
  try {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(data)
    );
    
    return {
      iv: Array.from(iv).join(','),
      data: Array.from(new Uint8Array(encrypted)).join(',')
    };
  } catch (error) {
    console.error("Encryption error:", error);
    throw error;
  }
}

export async function decryptData(key, encryptedData) {
  try {
    const iv = new Uint8Array(encryptedData.iv.split(',').map(Number));
    const data = new Uint8Array(encryptedData.data.split(',').map(Number));
    
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );
    
    return decoder.decode(decrypted);
  } catch (error) {
    console.error("Decryption error:", error);
    throw error;
  }
}