// src/main.jsx (o index.js)
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css'; // Asegúrate de importar tus estilos
import { AuthProvider } from './context/AuthContext'; // Importa el proveedor

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider> {/* Envuelve tu App con AuthProvider */}
      <App />
    </AuthProvider>
  </React.StrictMode>,
);