// src/App.jsx
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import Sidebar from './components/Sidebar';
import GeminiHero from './components/GeminiHero';
import ChatWindow from './components/ChatWindow';
import { useAuth } from './context/AuthContext';
import { useChatStore } from './hooks/useChatStore';
import { getBotResponse } from './services/apiService';

const App = () => {
  // ... (todo tu estado y hooks se mantienen igual)
  const [activeChatId, setActiveChatId] = useState(null);
  const { currentUser, loading: authLoading, signInWithGoogle, logout } = useAuth();
  const {
    chats,
    loadingChats,
    error: chatStoreError,
    createNewChat,
    addMessageToChat,
    deleteChat,
    decryptedMessagesMap,
    decryptingMessageIds,
    decryptMessageIfNeeded
  } = useChatStore(currentUser?.uid);

  const [isBotReplying, setIsBotReplying] = useState(false);

  const activeChatDetails = useMemo(() => {
    return chats.find(chat => chat.id === activeChatId);
  }, [chats, activeChatId]);

  const activeChatMessages = useMemo(() => {
    if (!activeChatDetails || !activeChatDetails.messages) return [];

    return activeChatDetails.messages.map(msg => {
      const decryptedText = decryptedMessagesMap.get(msg.id);
      const isCurrentlyDecrypting = decryptingMessageIds.has(msg.id);
      let displayText = msg.text; 

      if (msg.messageCiphertextKMS) {
        if (decryptedText === "[Error al descifrar]") {
          displayText = "[Error al descifrar]";
        } else if (decryptedText) {
          displayText = decryptedText;
        } else {
          displayText = isCurrentlyDecrypting ? "" : "Cargando mensaje...";
        }
      }
      
      return {
        ...msg,
        text: displayText,
        isDecrypting: isCurrentlyDecrypting || (msg.messageCiphertextKMS && !decryptedText && decryptedText !== "[Error al descifrar]"),
        hasErrorDecrypting: decryptedText === "[Error al descifrar]",
        sender: msg.originalSender || msg.sender || 'unknown'
      };
    });
  }, [activeChatDetails, decryptedMessagesMap, decryptingMessageIds]);

  useEffect(() => {
    if (activeChatDetails && activeChatDetails.messages) {
      activeChatDetails.messages.forEach(msg => {
        if (msg.messageCiphertextKMS) {
          decryptMessageIfNeeded(msg);
        }
      });
    }
  }, [activeChatDetails, decryptMessageIfNeeded]);

  const handleSendMessage = async (newMessageData) => {
    if (!currentUser) {
      toast.error("Por favor, inicia sesión para enviar mensajes.");
      return;
    }
    const { text } = newMessageData; 
    if (!text || text.trim() === '') return;

    try {
      let currentChatId = activeChatId;
      if (!currentChatId) {
        setIsBotReplying(true);
        // console.log("Creating new chat and sending first message...");
        const newChatId = await createNewChat(text);
        setActiveChatId(newChatId);
        currentChatId = newChatId;
        // console.log(`New chat created (${currentChatId}), fetching bot response...`);
        await fetchBotResponse(currentChatId, text);
      } else {
        setIsBotReplying(true);
        // console.log(`Adding message to existing chat (${currentChatId})...`);
        await addMessageToChat(currentChatId, { text, sender: 'user' });
        // console.log(`Message added, fetching bot response for chat ${currentChatId}...`);
        await fetchBotResponse(currentChatId, text);
      }
    } catch (sendError) {
      console.error("Error sending message or fetching bot response:", sendError);
      toast.error(`Error al enviar mensaje: ${sendError.message}`);
      setIsBotReplying(false);
    }
  };

  const fetchBotResponse = async (chatId, userPrompt) => {
    if (!chatId || !currentUser) {
        setIsBotReplying(false);
        return;
    }
    try {
      const botResponseText = await getBotResponse(userPrompt);
      await addMessageToChat(chatId, { text: botResponseText, sender: 'bot' });
    } catch (fetchError) {
      console.error(`Error getting or adding bot response for chat ${chatId}:`, fetchError);
      toast.error(`Falló la obtención de respuesta del bot: ${fetchError.message}`);
      try {
        if (chatId) {
          await addMessageToChat(chatId, { text: `Lo siento, encontré un error: ${fetchError.message}`, sender: 'system' });
        }
      } catch (addError) {
        console.error("Falló al añadir mensaje de error del bot al chat:", addError);
      }
    } finally {
      setIsBotReplying(false);
    }
  };

  const handleSelectChat = (chatId) => { setActiveChatId(chatId); };
  const handleNewChatClick = () => { setActiveChatId(null); setIsBotReplying(false); };

  const handleDeleteChat = useCallback(async (chatIdToDelete) => {
    if (!currentUser) return;
    try {
      await deleteChat(chatIdToDelete);
      toast.success('Chat eliminado exitosamente!');
      if (activeChatId === chatIdToDelete) {
        setActiveChatId(null);
        setIsBotReplying(false);
      }
    } catch (err) { toast.error(`Falló la eliminación del chat: ${err.message}`); }
  }, [currentUser, deleteChat, activeChatId]);

  const handleSignIn = async () => { 
    try { 
      await signInWithGoogle(); 
      toast.success("¡Has iniciado sesión exitosamente!"); 
    } catch (e) { 
      toast.error(`Falló el inicio de sesión: ${e.message}`); 
      console.error("Sign in error:", e);
    }
  };

  const handleSignOut = async () => { 
    try { 
      await logout(); 
      setActiveChatId(null); 
      setIsBotReplying(false); 
      toast.success("¡Has cerrado sesión exitosamente!"); 
    } catch (e) { 
      toast.error(`Falló el cierre de sesión: ${e.message}`); 
      console.error("Sign out error:", e);
    }
  };

  useEffect(() => { 
    if (chatStoreError) { 
      toast.error(`Error del Chat Store: ${chatStoreError}`); 
      setIsBotReplying(false); 
    }
  }, [chatStoreError]);

  let chatWindowContent;

  if (authLoading) {
    chatWindowContent = <div className="flex-1 flex justify-center items-center"><p className="text-gray-400">Autenticando...</p></div>;
  } else if (!currentUser) {
    chatWindowContent = (
      <div className="flex-1 flex flex-col justify-center items-center text-center px-6 pb-10">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Conoce a <span style={{ WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundImage: '-webkit-linear-gradient(16deg,#4b90ff, #ff5546)' }}>Gemini</span>
        </h1>
        <p className="text-lg md:text-xl text-gray-400 mb-6">Inicia sesión para comenzar tu conversación.</p>
        {/* Este es el botón de Sign In que se mantiene en el centro de la pantalla */}
         <button 
            onClick={handleSignIn} 
            className="bg-white text-gray-900 font-medium rounded-full px-6 py-2.5 hover:bg-gray-100"
        >
            Sign in with Google
        </button>
      </div>
    );
  } else if (loadingChats && !activeChatDetails) {
    chatWindowContent = <div className="flex-1 flex justify-center items-center"><p className="text-gray-400">Cargando tus chats...</p></div>;
  } else if (activeChatId && !activeChatDetails && !loadingChats) {
    chatWindowContent = <div className="flex-1 flex justify-center items-center"><p className="text-gray-400">Cargando chat...</p></div>;
  } else if (activeChatId && activeChatDetails) {
      const isAnyMessageInActiveChatStillProcessing = activeChatDetails.messages.some(
        msg => msg.messageCiphertextKMS && (!decryptedMessagesMap.has(msg.id) || decryptingMessageIds.has(msg.id)) && decryptedMessagesMap.get(msg.id) !== "[Error al descifrar]"
      );

      if (isBotReplying || isAnyMessageInActiveChatStillProcessing) {
          if (activeChatMessages.length === 0 || activeChatMessages.every(m => m.text === "" || m.text === "Cargando mensaje..." || m.text === "[Contenido Cifrado]")) {
            chatWindowContent = <div className="flex-1 flex justify-center items-center"><p className="text-gray-400">{isBotReplying ? "" : "Procesando mensajes..."}</p></div>;
          } else {
            chatWindowContent = (
              <ChatWindow
                messages={activeChatMessages}
                key={activeChatId}
                isBotReplying={isBotReplying && activeChatId === activeChatDetails?.id}
              />
            );
          }
      } else {
        chatWindowContent = (
          <ChatWindow
            messages={activeChatMessages}
            key={activeChatId}
            isBotReplying={false}
          />
        );
      }
  } else { 
    chatWindowContent = ( 
      <div className="flex-1 flex flex-col justify-center items-center text-center px-6 pb-10">
        <h1 className="text-4xl md:text-5xl font-semibold mb-3">¡Hola, {currentUser.displayName?.split(' ')[0] || 'Usuario'}!</h1>
        <p className="text-lg md:text-xl text-gray-400">Selecciona un chat o crea uno nuevo.</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-900 text-white">
      <ToastContainer position="bottom-right" autoClose={4000} theme="dark" />
      <Sidebar
        currentUser={currentUser}
        onLogout={handleSignOut}
        chats={chats}
        onSelectChat={handleSelectChat}
        activeChatId={activeChatId}
        onNewChat={handleNewChatClick}
        onDeleteChat={handleDeleteChat}
        isLoading={authLoading || loadingChats}
      />
      <div className="flex-1 flex flex-col relative overflow-hidden">
        {/* ===== INICIO DE LA MODIFICACIÓN ===== */}
        {/* Este div contiene la información del usuario o el botón de login superior */}
        <div className="absolute top-4 right-4 sm:right-6 z-30 flex items-center space-x-2 sm:space-x-3 max-w-xs">
          {authLoading ? null : currentUser ? (
            // Si el usuario está autenticado y no está cargando, muestra su foto y nombre
            <>
              {currentUser.photoURL && <img src={currentUser.photoURL} alt="User profile" className="h-8 w-8 rounded-full flex-shrink-0" />}
              <span className="text-sm text-gray-300 hidden sm:inline truncate" title={currentUser.displayName || currentUser.email}>{currentUser.displayName || currentUser.email}</span>
            </>
          ) : (
            // Si el usuario NO está autenticado y NO está cargando la autenticación,
            // antes aquí estaba el botón "Sign in with Google".
            // Ahora lo reemplazamos con `null` para que no se renderice nada.
            null 
          )}
        </div>
        {/* ===== FIN DE LA MODIFICACIÓN ===== */}

        <div className="flex-1 flex flex-col overflow-y-auto pt-20"> {/* Se añade pt-20 para dar espacio al contenido que estaba debajo del botón superior */}
          {chatWindowContent}
        </div>

        {currentUser && !authLoading && (
          <div className="px-6 pb-4 pt-4 border-t border-gray-700/50 mt-auto">
            <GeminiHero
              onSendMessage={handleSendMessage}
              currentUser={currentUser}
              key={activeChatId || 'new-chat-input'}
              isSending={isBotReplying || (activeChatId && decryptingMessageIds.size > 0)}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default App;