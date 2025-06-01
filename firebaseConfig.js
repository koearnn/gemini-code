    // firebaseConfig.js
    import { initializeApp } from "firebase/app";
    import { getAuth } from "firebase/auth";
    import { getFirestore } from "firebase/firestore";

    // Accede a las variables de entorno
    const firebaseConfig = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
      measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID // Opcional
    };

    // Initialize Firebase
    const app = initializeApp(firebaseConfig);

    const auth = getAuth(app);

    // --- MODIFICACIÓN IMPORTANTE ---
    // Reemplaza 'tu-nombre-de-db' con el nombre real de tu base de datos si NO es '(default)'
    // Si tu base de datos SÍ es '(default)', deja la línea como estaba: const db = getFirestore(app);
    const databaseName = import.meta.env.VITE_FIRESTORE_DB_NAME || '(default)'; // Opcional: Lee de variable de entorno o pon el nombre directamente

    const db = databaseName === '(default)'
      ? getFirestore(app)
      : getFirestore(app, databaseName); // Pasa el nombre si es necesario

    console.log(`Firestore initialized for database: ${databaseName === '(default)' ? '(default)' : databaseName}`); // Log para confirmar

    export { auth, app, db };
    