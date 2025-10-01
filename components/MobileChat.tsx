import React, { useState, useEffect, useRef } from 'react';
import { type ChatMessage, type User } from '../types';
import { CloseIcon } from './icons/CloseIcon';
import { PaperAirplaneIcon } from './icons/PaperAirplaneIcon';
import { EmojiHappyIcon } from './icons/EmojiHappyIcon';

const EMOJIS = ['😀', '😂', '😍', '🤔', '👍', '🙏', '🔥', '🎉', '❤️', '💯', '📻', '🎙️'];

interface MobileChatProps {
    isOpen: boolean;
    onClose: () => void;
    messages: ChatMessage[];
    onSendMessage: (text: string, from: string) => void;
    currentUser: User | null;
}

const MobileChat: React.FC<MobileChatProps> = ({ isOpen, onClose, messages, onSendMessage, currentUser }) => {
    const [nickname, setNickname] = useState(() => localStorage.getItem('chatNickname') || `Listener-${Math.floor(Math.random() * 9000) + 1000}`);
    const [inputText, setInputText] = useState('');
    const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            // Use 'auto' instead of 'instant' for better performance on mobile when keyboard appears
            messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
            setTimeout(() => inputRef.current?.focus(), 300); // After animation
        }
    }, [isOpen]);
    
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleNicknameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newNick = e.target.value;
        setNickname(newNick);
        localStorage.setItem('chatNickname', newNick);
    };

    const handleSend = (e: React.FormEvent) => {
        e.preventDefault();
        const text = inputText.trim();
        if (text) {
            onSendMessage(text, currentUser?.role === 'studio' ? 'Studio' : nickname);
            setInputText('');
            setIsEmojiPickerOpen(false);
        }
    };
    
    const addEmoji = (emoji: string) => {
        setInputText(prev => prev + emoji);
        inputRef.current?.focus();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed top-0 left-0 w-full h-full bg-black z-40 flex flex-col animate-slide-in-up">
            {/* Header */}
            <header className="flex-shrink-0 flex items-center justify-between p-2 bg-neutral-900 border-b border-neutral-800">
                <div className="flex-grow pl-2">
                     <input
                        type="text"
                        value={nickname}
                        onChange={handleNicknameChange}
                        placeholder="Your Nickname"
                        className="bg-transparent text-lg font-bold text-white w-full outline-none placeholder-neutral-500"
                        disabled={currentUser?.role === 'studio'}
                    />
                </div>
                <button onClick={onClose} className="p-2 rounded-full text-neutral-400 hover:bg-neutral-800">
                    <CloseIcon className="w-6 h-6" />
                </button>
            </header>
            
            {/* Messages */}
            <div className="flex-grow overflow-y-auto p-4 space-y-4">
                {messages.map((msg, index) => {
                    const isMe = msg.from === (currentUser?.role === 'studio' ? 'Studio' : nickname);
                    return (
                        <div key={msg.timestamp + '-' + index} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                            <div className={`max-w-[80%] p-3 rounded-2xl ${isMe ? 'bg-blue-600 text-white rounded-br-lg' : 'bg-neutral-800 text-white rounded-bl-lg'}`}>
                                {!isMe && <p className="text-xs font-bold text-neutral-400 mb-1">{msg.from}</p>}
                                <p className="text-base break-words whitespace-pre-wrap">{msg.text}</p>
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>
            
            {/* Input */}
            <footer className="flex-shrink-0 bg-neutral-900 border-t border-neutral-800">
                {isEmojiPickerOpen && (
                    <div className="p-2 grid grid-cols-6 gap-2">
                        {EMOJIS.map(emoji => (
                            <button key={emoji} onClick={() => addEmoji(emoji)} className="text-3xl rounded-lg hover:bg-neutral-800 p-1 transition-colors">
                                {emoji}
                            </button>
                        ))}
                    </div>
                )}
                <form onSubmit={handleSend} className="flex items-center gap-2 p-2">
                    <button type="button" onClick={() => setIsEmojiPickerOpen(p => !p)} className="p-2 text-neutral-400 hover:text-white flex-shrink-0">
                        <EmojiHappyIcon className="w-6 h-6" />
                    </button>
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder="Message..."
                        className="flex-1 min-w-0 bg-neutral-800 border-none rounded-full px-4 py-2 text-white placeholder-neutral-500 focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <button type="submit" className="p-2 text-blue-500 hover:text-blue-400 disabled:text-neutral-600 flex-shrink-0" disabled={!inputText.trim()}>
                        <PaperAirplaneIcon className="w-6 h-6" />
                    </button>
                </form>
            </footer>
        </div>
    );
};

export default MobileChat;