// src/components/ChatMessage.jsx
import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';


/**
 * Memoized component configuration for ReactMarkdown
 * This prevents recreation of the components object on every render
 */
const markdownComponents = {
  a: ({node, ...props}) => (
    <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:underline"/>
  ),
  code({node, inline, className, children, ...props}) {
    const match = /language-(\w+)/.exec(className || '');
    return !inline ? (
      <pre className="bg-gray-800/50 p-2 rounded my-1 overflow-x-auto text-xs">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    ) : (
      <code className="bg-gray-600/80 px-1 rounded text-xs" {...props}>
        {children}
      </code>
    );
  },
};

const ChatMessage = React.memo(({ msg }) => {
  const isUser = useMemo(() => msg.sender === 'user', [msg.sender]);

  
  const messageStyles = useMemo(() => {
    const alignment = isUser ? 'justify-end' : 'justify-start';
    const bgColor = isUser
      ? 'bg-gradient-to-br from-blue-600 to-blue-500 rounded-br-none'
      : 'bg-gray-700 rounded-bl-none'; //
    const textColor = 'text-white';
    
    const stateStyles = [];
    if (msg.hasErrorDecrypting) {
      stateStyles.push('border border-red-500 opacity-80');
    }

    
    // Podemos quitar la opacidad si el spinner ya indica carga
    // if (msg.isDecrypting) { 
    //   stateStyles.push('opacity-60');
    // }
    
    return {
      containerClass: `flex ${alignment} w-full`,
      messageClass: `p-3 md:p-4 rounded-lg break-words max-w-[85%] md:max-w-[75%] text-sm md:text-base shadow-md ${bgColor} ${textColor} ${stateStyles.join(' ')} transition-opacity duration-300 ease-in-out` // Añadida transición
    };
  }, [isUser, msg.hasErrorDecrypting, msg.isDecrypting /* msg.isDecrypting puede quitarse si no afecta el estilo base */]);
  
  // El texto que se pasa a ReactMarkdown. Si no hay spinner, es el texto del mensaje.
  const displayedText = useMemo(() => msg.text || '', [msg.text]);
  
  return (
    <div className={messageStyles.containerClass}>
      <div className={messageStyles.messageClass}>
        {/* NUEVA LÓGICA: Mostrar spinner o texto */}
        {msg._shouldRenderSpinner && msg.sender !== 'user' ? (
          <div className="flex items-center justify-center py-1"> {/* Ajusta padding si es necesario */}
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
          </div>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {displayedText}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Actualizar la comparación para React.memo si hemos añadido _shouldRenderSpinner
  return (
    prevProps.msg.id === nextProps.msg.id &&
    prevProps.msg.text === nextProps.msg.text &&
    prevProps.msg.sender === nextProps.msg.sender &&
    prevProps.msg.isDecrypting === nextProps.msg.isDecrypting && // Podría ser relevante si aún afecta estilos
    prevProps.msg.hasErrorDecrypting === nextProps.msg.hasErrorDecrypting &&
    prevProps.msg._shouldRenderSpinner === nextProps.msg._shouldRenderSpinner // Nueva prop
  );
});

ChatMessage.displayName = 'ChatMessage';

export default ChatMessage;