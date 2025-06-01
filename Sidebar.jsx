// Sidebar.jsx
import { useState } from "react";
import { CiMenuBurger, CiChat1, CiUser, CiLogout } from "react-icons/ci";
import { FaPlus, FaTrashAlt } from "react-icons/fa";
// Toastify: Importar toast
import { toast } from 'react-toastify';

// --- Componente para el Toast de Confirmación ---
// Puedes colocarlo aquí o en un archivo separado si lo prefieres
const ConfirmToast = ({ closeToast, onConfirm, message }) => (
  <div className="text-white">
    <p className="mb-3 text-sm">{message}</p>
    <div className="flex justify-end space-x-2">
      <button
        onClick={() => {
          onConfirm(); // Ejecuta la acción de confirmar (borrar)
          closeToast(); // Cierra el toast
        }}
        className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-xs font-medium"
      >
        Confirmar
      </button>
      <button
        onClick={closeToast} // Solo cierra el toast
        className="px-3 py-1 bg-gray-500 hover:bg-gray-600 rounded text-xs font-medium"
      >
        Cancelar
      </button>
    </div>
  </div>
);


function Sidebar({
  currentUser,
  onLogout,
  chats = [],
  onSelectChat,
  activeChatId,
  onNewChat,
  onDeleteChat
}) {
  const [open, setOpen] = useState(true);

  const handleToggleSidebar = () => setOpen(!open);

  const AccountLogoutMenus = currentUser
    ? [
        { title: currentUser.displayName || currentUser.email, icon: <CiUser size={20} />, isInfo: true },
        { title: "Logout", icon: <CiLogout size={20} />, action: onLogout }
      ]
    : [];

  // --- Handler para el botón de eliminar (MODIFICADO) ---
  const handleDeleteClick = (e, chatId, chatTitle) => {
    e.stopPropagation(); // Evita que el click también seleccione el chat

    const confirmationMessage = `Are you sure you want to delete the chat "${chatTitle || 'Untitled Chat'}"?`;

    // Toastify: Mostrar toast de confirmación en lugar de window.confirm
    toast(
      // Pasamos una función que recibe closeToast y renderiza nuestro componente
      ({ closeToast }) => (
        <ConfirmToast
          closeToast={closeToast}
          message={confirmationMessage}
          onConfirm={() => onDeleteChat(chatId)} // La acción a ejecutar si se confirma
        />
      ),
      {
        position: "top-center", // O la posición que prefieras para confirmaciones
        autoClose: false, // No cerrar automáticamente
        closeOnClick: false, // No cerrar al hacer clic en el toast
        draggable: false, // No permitir arrastrar
        closeButton: false, // Ocultar botón de cierre por defecto (usamos los nuestros)
        theme: "dark", // Mantener el tema oscuro
        // Puedes añadir un toastId para evitar duplicados si el usuario hace clic muy rápido
        toastId: `confirm-delete-${chatId}`
      }
    );
  };

  return (
    // El resto del componente sigue igual...
    <div className={`bg-zinc-800 h-screen flex flex-col transition-width duration-300 border-r border-gray-700/30 ${open ? "w-64" : "w-20"}`}>
      {/* Header */}
      <div className={`p-4 pt-6 flex items-center ${open ? 'justify-between' : 'justify-center'} border-b border-gray-700/50`}>
        {open && currentUser && (
          <button onClick={onNewChat} className="flex items-center gap-x-2 px-3 py-1.5 rounded-md text-sm text-gray-200 bg-gray-700 hover:bg-gray-600" title="New Chat">
            <FaPlus className="text-lg" />
            <span>New Chat</span>
          </button>
        )}
        <button onClick={handleToggleSidebar} className="text-gray-300 hover:text-white" aria-label={open ? 'Close sidebar' : 'Open sidebar'}>
          <CiMenuBurger className="text-2xl" />
        </button>
      </div>

      {/* Chat List */}
      <nav className="flex-1 overflow-y-auto mt-3 px-2 space-y-1">
        {open && chats.length > 0 && <h3 className="text-xs font-medium text-gray-400 px-2 pt-2 pb-1 uppercase tracking-wider">Recent Chats</h3>}
        {currentUser && chats.map((chat) => (
          <div key={chat.id} className="relative group"> {/* group para hover */}
            <button
              className={`w-full text-left text-gray-200 text-sm flex items-center gap-x-3 px-3 py-2.5 rounded-md transition-colors ${open ? '' : 'justify-center'} ${
                activeChatId === chat.id ? 'bg-gray-600/80 font-medium' : 'hover:bg-gray-700'
              }`}
              onClick={() => onSelectChat(chat.id)}
              title={chat.title}
            >
              <CiChat1 className={`text-lg flex-shrink-0 ${open ? '' : 'mx-auto'}`} />
              <span className={`flex-1 truncate ${!open && "hidden"}`}>
                {chat.title || `Chat`}
              </span>
            </button>
            {open && (
              <button
                onClick={(e) => handleDeleteClick(e, chat.id, chat.title)} // Llama al nuevo handler
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-gray-400 hover:bg-red-800/50 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100"
                title="Delete chat"
                aria-label={`Delete chat ${chat.title || 'Untitled Chat'}`}
              >
                <FaTrashAlt className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {open && currentUser && chats.length === 0 && <p className="text-xs text-gray-400 px-3 py-2 text-center">Start a conversation!</p>}
        {open && !currentUser && <p className="text-xs text-gray-400 px-3 py-2 text-center">Sign in to view chats.</p>}
      </nav>

      {/* Account Info / Logout */}
      <ul className="mt-auto p-3 pt-2 border-t border-gray-700/50 space-y-1">
        {AccountLogoutMenus.map((menu, index) => (
          <li key={index}>
            <button
              className={`w-full text-left text-gray-300 text-sm flex items-center gap-x-3 px-3 py-2 rounded-md ${menu.action ? 'hover:bg-gray-700' : 'cursor-default opacity-80'} ${!open ? 'justify-center' : ''}`}
              onClick={menu.action || undefined}
              disabled={!menu.action}
            >
              <span className="flex-shrink-0">{menu.icon}</span>
              <span className={`flex-1 truncate ${!open && "hidden"}`}>
                {menu.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Sidebar;