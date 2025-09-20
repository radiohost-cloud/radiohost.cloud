import React, { useState, useRef, useEffect, useCallback } from 'react';
import { type CartwallItem, type CartwallPage } from '../types';
import { getTrackSrc } from '../services/dataService';
import { PlusIcon } from './icons/PlusIcon';
import { TrashIcon } from './icons/TrashIcon';

const MAX_MOBILE_PLAYERS = 4;

interface MobileCartwallProps {
    pages: CartwallPage[];
    onStreamReady: (stream: MediaStream | null) => void;
}

const MobileCartwall: React.FC<MobileCartwallProps> = ({ pages, onStreamReady }) => {
    const [activePageId, setActivePageId] = useState<string>(pages[0]?.id || 'default');
    const playersRef = useRef<HTMLAudioElement[]>([]);
    const [activePlayers, setActivePlayers] = useState<Map<number, { progress: number, duration: number }>>(new Map());
    const animationFrameRef = useRef<number | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);

    const activePage = pages.find(p => p.id === activePageId) || pages[0];

    useEffect(() => {
        const context = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = context;
        const destination = context.createMediaStreamDestination();
        onStreamReady(destination.stream);

        playersRef.current = Array.from({ length: MAX_MOBILE_PLAYERS }, () => {
            const audio = new Audio();
            audio.crossOrigin = 'anonymous';
            const source = context.createMediaElementSource(audio);
            source.connect(destination);
            return audio;
        });

        return () => {
            context.close().catch(e => console.error("Error closing AudioContext", e));
            onStreamReady(null);
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [onStreamReady]);

    useEffect(() => {
        const updateProgress = () => {
            let hasActivePlayers = false;
            setActivePlayers(prev => {
                const newActive = new Map(prev);
                let changed = false;
                playersRef.current.forEach((player, index) => {
                    if (!player.paused && !player.ended && player.duration > 0) {
                        hasActivePlayers = true;
                        newActive.set(index, { progress: player.currentTime, duration: player.duration });
                        changed = true;
                    } else if (newActive.has(index)) {
                        newActive.delete(index);
                        changed = true;
                    }
                });
                return changed ? newActive : prev;
            });

            if (hasActivePlayers) {
                animationFrameRef.current = requestAnimationFrame(updateProgress);
            } else {
                animationFrameRef.current = null;
            }
        };

        if (activePlayers.size > 0 && !animationFrameRef.current) {
            animationFrameRef.current = requestAnimationFrame(updateProgress);
        }
    }, [activePlayers.size]);

    const handlePlay = useCallback(async (item: CartwallItem, cartIndex: number) => {
        const activePlayerEntry = Array.from(activePlayers.entries()).find(([key]) => playersRef.current[key]?.dataset.cartIndex === String(cartIndex));

        if (activePlayerEntry) {
            const [playerIndex] = activePlayerEntry;
            const player = playersRef.current[playerIndex];
            player.pause();
            player.currentTime = 0;
            return;
        }

        const freePlayerIndex = playersRef.current.findIndex(p => p.paused || p.ended);
        if (freePlayerIndex === -1) {
            console.warn("Mobile Cartwall: No free players.");
            return;
        }

        const player = playersRef.current[freePlayerIndex];
        const src = await getTrackSrc(item);

        if (src) {
            if (player.src && player.src.startsWith('blob:')) URL.revokeObjectURL(player.src);
            player.src = src;
            player.dataset.cartIndex = String(cartIndex);
            try {
                if (audioContextRef.current?.state === 'suspended') await audioContextRef.current.resume();
                await player.play();
                setActivePlayers(prev => new Map(prev).set(freePlayerIndex, { progress: 0, duration: player.duration }));
            } catch (e) {
                console.error("Mobile Cartwall playback failed:", e);
            }
        }
    }, [activePlayers]);

    if (!activePage) {
        return <div className="p-4 text-center text-neutral-500">No cartwall pages found.</div>;
    }

    const gridConfig = { rows: 4, cols: 3 }; // Fixed grid for mobile simplicity
    const gridStyle = {
        gridTemplateColumns: `repeat(${gridConfig.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${gridConfig.rows}, minmax(0, 1fr))`,
    };

    return (
        <div className="flex flex-col h-full bg-black">
            <div className="flex-shrink-0 flex items-center border-b border-neutral-800">
                <div className="flex-grow flex items-center overflow-x-auto">
                    {pages.map(page => (
                        <button
                            key={page.id}
                            onClick={() => setActivePageId(page.id)}
                            className={`px-3 py-2 text-sm font-semibold whitespace-nowrap ${activePageId === page.id ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:bg-neutral-800/50'}`}
                        >
                            {page.name}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-grow p-1 overflow-auto">
                <div className="grid gap-1 h-full w-full" style={gridStyle}>
                    {Array.from({ length: gridConfig.rows * gridConfig.cols }).map((_, index) => {
                        const item = activePage.items[index];
                        const activePlayerEntry = Array.from(activePlayers.entries()).find(([key]) => playersRef.current[key]?.dataset.cartIndex === String(index));
                        const isPlaying = !!activePlayerEntry;
                        const progress = isPlaying ? (activePlayerEntry[1].progress / activePlayerEntry[1].duration) * 100 : 0;

                        return (
                            <div
                                key={index}
                                className={`relative flex flex-col justify-center items-center p-2 rounded-md text-center text-white ${isPlaying ? 'animate-pulse-cart' : ''}`}
                                style={{ backgroundColor: item?.color || (item ? '#3f3f46' : '#1f2937') }}
                                onClick={() => item && handlePlay(item, index)}
                            >
                                {item ? (
                                    <>
                                        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/30">
                                            <div className="h-full bg-green-500" style={{ width: `${progress}%` }}></div>
                                        </div>
                                        <p className="font-bold text-sm leading-tight [text-shadow:_1px_1px_2px_rgb(0_0_0_/_0.5)]">{item.title}</p>
                                        {item.artist && <p className="text-xs opacity-80 [text-shadow:_1px_1px_2px_rgb(0_0_0_/_0.5)]">{item.artist}</p>}
                                    </>
                                ) : (
                                    <div className="w-6 h-6 text-neutral-600"></div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default React.memo(MobileCartwall);
