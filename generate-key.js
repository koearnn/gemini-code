// generate-key.js
import { randomBytes } from 'crypto';

// Genera una clave segura de 256 bits (32 bytes) para AES-256
const key = randomBytes(32);
const base64Key = key.toString('base64');

console.log('Clave de Cifrado Generada (en Base64):');
console.log(base64Key);
console.log('\n¡IMPORTANTE!');
console.log('1. Guarda esta clave en un lugar MUY seguro (como un gestor de contraseñas).');
console.log('2. Esta es la clave que debes añadir a Google Cloud Secret Manager.');
console.log('3. NO la subas a tu repositorio de código.');