
import React, { useState, useEffect, useRef } from 'react';
import { type ChatMessage } from '../types';
import { PaperAirplaneIcon } from './icons/PaperAirplaneIcon';

interface ChatProps {
    messages: ChatMessage[];
    onSendMessage: (text: string) => void;
}

const Chat: React.FC<ChatProps> = ({ messages, onSendMessage }) => {
    const [inputText, setInputText] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const text = inputText.trim();
        if (text) {
            onSendMessage(text);
            setInputText('');
        }
    };

    return (
        <div className="p-4 h-full flex flex-col bg-neutral-100 dark:bg-neutral-900">
            <h3 className="text-lg font-semibold text-black dark:text-white flex-shrink-0 mb-4">
                Listener Chat
            </h3>
            <div className="flex-grow overflow-y-auto pr-2 space-y-4">
                {messages.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-center text-neutral-500">
                        <p>No messages yet. <br/> Listeners on the public stream page can chat with you here.</p>
                    </div>
                ) : (
                    messages.map((msg, index) => {
                        const isStudio = msg.from === 'Studio';
                        const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                        return (
                            <div key={index} className={`flex flex-col ${isStudio ? 'items-end' : 'items-start'}`}>
                                <div className={`max-w-[80%] p-3 rounded-xl ${isStudio ? 'bg-blue-600 text-white rounded-br-none' : 'bg-neutral-200 dark:bg-neutral-800 rounded-bl-none'}`}>
                                    {!isStudio && <p className="text-xs font-bold text-neutral-600 dark:text-neutral-400 mb-1">{msg.from}</p>}
                                    <p className="text-sm">{msg.text}</p>
                                </div>
                                <p className="text-xs text-neutral-500 mt-1 px-1">{time}</p>
                            </div>
                        );
                    })
                )}
                <div ref={messagesEndRef} />
            </div>
            <div className="flex-shrink-0 pt-4">
                <form onSubmit={handleSubmit} className="flex gap-2">
                    <input
                        type="text"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder="Type your message..."
                        className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-sm text-black dark:text-white"
                        aria-label="Chat message input"
                    />
                    <button
                        type="submit"
                        className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 disabled:bg-neutral-500"
                        aria-label="Send message"
                        disabled={!inputText.trim()}
                    >
                        <PaperAirplaneIcon className="w-5 h-5"/>
                    </button>
                </form>
            </div>
        </div>
    );
};

export default React.memo(Chat);
