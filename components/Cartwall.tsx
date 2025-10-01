import React, { useState, useRef, useEffect, useCallback } from 'react';
import { type Track, type CartwallItem, type CartwallPage } from '../types';
import ConfirmationDialog from './ConfirmationDialog';
import { PlusIcon } from './icons/PlusIcon';
import { CogIcon } from './icons/CogIcon';
import { TrashIcon } from './icons/TrashIcon';

interface CartwallProps {
    pages: CartwallPage[];
    onUpdatePages: (newPages: CartwallPage[]) => void;
    activePageId: string;
    onSetActivePageId: (pageId: string) => void;
    gridConfig: { rows: number; cols: number };
    onGridConfigChange: (newGrid: { rows: number; cols: number }) => void;
    onPlay: (track: CartwallItem, index: number) => void;
    activePlayers: Map<number, { progress: number, duration: number }>;
}

const Cartwall: React.FC<CartwallProps> = ({ pages, onUpdatePages, activePageId, onSetActivePageId, gridConfig, onGridConfigChange, onPlay, activePlayers }) => {
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, index: number } | null>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const colorInputRef = useRef<HTMLInputElement>(null);
    const [coloringIndex, setColoringIndex] = useState<number | null>(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const settingsRef = useRef<HTMLDivElement>(null);
    const [editingPage, setEditingPage] = useState<{ id: string, name: string } | null>(null);
    const [clearConfirm, setClearConfirm] = useState<{ page: boolean, index: number | null }>({ page: false, index: null });
    
    const activePage = pages.find(p => p.id === activePageId) || pages[0];

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
                setContextMenu(null);
            }
            if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
                setIsSettingsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handlePlay = useCallback((index: number) => {
        if (!activePage || !activePage.items[index]) return;
        const track = activePage.items[index];
        if (track) {
            onPlay(track, index);
        }
    }, [activePage, onPlay]);
    
    const handleDrop = useCallback((e: React.DragEvent, index: number) => {
        e.preventDefault();
        const trackJson = e.dataTransfer.getData('application/json');
        if (trackJson) {
            try {
                const track = JSON.parse(trackJson) as Track;
                if (track?.id) {
                    const newPages = pages.map(p => {
                        if (p.id === activePageId) {
                            const newItems = [...p.items];
                            newItems[index] = { ...track, color: undefined };
                            return { ...p, items: newItems };
                        }
                        return p;
                    });
                    onUpdatePages(newPages);
                }
            } catch (err) {
                console.error("Cartwall drop failed:", err);
            }
        }
    }, [pages, activePageId, onUpdatePages]);

    const handleClearItem = (index: number) => {
        const newPages = pages.map(p => {
            if (p.id === activePageId) {
                const newItems = [...p.items];
                newItems[index] = null;
                return { ...p, items: newItems };
            }
            return p;
        });
        onUpdatePages(newPages);
        setContextMenu(null);
    };

    const handleClearPage = () => {
        const newPages = pages.map(p => {
            if (p.id === activePageId) {
                return { ...p, items: Array(gridConfig.rows * gridConfig.cols).fill(null) };
            }
            return p;
        });
        onUpdatePages(newPages);
        setIsSettingsOpen(false);
    };

    const handleAddPage = () => {
        const newPage: CartwallPage = {
            id: `page-${Date.now()}`,
            name: `Page ${pages.length + 1}`,
            items: Array(gridConfig.rows * gridConfig.cols).fill(null),
        };
        onUpdatePages([...pages, newPage]);
        onSetActivePageId(newPage.id);
    };

    const handleRenamePage = (newName: string) => {
        if (!editingPage) return;
        const newPages = pages.map(p => p.id === editingPage.id ? { ...p, name: newName } : p);
        onUpdatePages(newPages);
        setEditingPage(null);
    };
    
    const handleDeletePage = (pageId: string) => {
        if (pages.length <= 1) return;
        const newPages = pages.filter(p => p.id !== pageId);
        if (activePageId === pageId) {
            onSetActivePageId(newPages[0].id);
        }
        onUpdatePages(newPages);
    };
    
    const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (coloringIndex === null) return;
        const newColor = e.target.value;
        const newPages = pages.map(p => {
            if (p.id === activePageId) {
                const newItems = [...p.items];
                const item = newItems[coloringIndex!];
                if (item) {
                    newItems[coloringIndex!] = { ...item, color: newColor };
                }
                return { ...p, items: newItems };
            }
            return p;
        });
        onUpdatePages(newPages);
    };

    const handleContextMenu = (e: React.MouseEvent, index: number) => {
        if (!activePage?.items[index]) return;
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, index });
    };

    const gridStyle = {
        gridTemplateColumns: `repeat(${gridConfig.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${gridConfig.rows}, minmax(0, 1fr))`,
    };

    return (
        <div className="flex flex-col h-full bg-neutral-100 dark:bg-neutral-900">
             {/* Tabs & Settings */}
            <div className="flex-shrink-0 flex items-center border-b border-neutral-200 dark:border-neutral-800 relative">
                <div className="flex-grow flex items-center overflow-x-auto">
                    {pages.map(page => (
                        <div key={page.id} className="relative group">
                            <button
                                onDoubleClick={() => setEditingPage({ id: page.id, name: page.name })}
                                onClick={() => onSetActivePageId(page.id)}
                                className={`px-3 py-2 text-sm font-semibold whitespace-nowrap ${activePageId === page.id ? 'bg-neutral-200 dark:bg-neutral-800 text-black dark:text-white' : 'text-neutral-500 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'}`}
                            >
                                {editingPage?.id === page.id ? (
                                    <input
                                        type="text"
                                        defaultValue={page.name}
                                        autoFocus
                                        onBlur={(e) => handleRenamePage(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                        className="bg-transparent outline-none border-b border-blue-500"
                                    />
                                ) : (
                                    page.name
                                )}
                            </button>
                             {pages.length > 1 && (
                                <button
                                    onClick={() => handleDeletePage(page.id)}
                                    className="absolute top-0 right-0 p-0.5 bg-neutral-400/50 dark:bg-neutral-600/50 rounded-full text-white opacity-0 group-hover:opacity-100"
                                    title="Delete page"
                                >
                                    <TrashIcon className="w-3 h-3"/>
                                </button>
                            )}
                        </div>
                    ))}
                    <button onClick={handleAddPage} className="p-2 text-neutral-500 hover:text-black dark:hover:text-white"><PlusIcon className="w-5 h-5"/></button>
                </div>
                <div className="flex-shrink-0 relative" ref={settingsRef}>
                    <button onClick={() => setIsSettingsOpen(p => !p)} className="p-2 h-full text-neutral-500 hover:text-black dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-800"><CogIcon className="w-5 h-5"/></button>
                     {isSettingsOpen && (
                        <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-md shadow-lg z-20 p-4 space-y-4">
                            <h4 className="font-semibold text-sm">Grid Size</h4>
                            <div className="space-y-2">
                                <label className="flex justify-between text-xs">Rows: <span>{gridConfig.rows}</span></label>
                                <input type="range" min="1" max="8" value={gridConfig.rows} onChange={e => onGridConfigChange({ ...gridConfig, rows: Number(e.target.value)})} className="w-full" />
                            </div>
                            <div className="space-y-2">
                                <label className="flex justify-between text-xs">Columns: <span>{gridConfig.cols}</span></label>
                                <input type="range" min="1" max="8" value={gridConfig.cols} onChange={e => onGridConfigChange({ ...gridConfig, cols: Number(e.target.value)})} className="w-full" />
                            </div>
                            <div className="pt-2 border-t border-neutral-200 dark:border-neutral-700">
                                <button onClick={() => setClearConfirm({ page: true, index: null })} className="w-full text-left text-sm text-red-500 hover:text-red-700">Clear Page</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Grid */}
            <div className="flex-grow p-1 overflow-auto">
                <div className="grid gap-1 h-full w-full" style={gridStyle}>
                    {activePage?.items.map((item, index) => {
                        const activePlayer = activePlayers.get(index);
                        const isPlaying = !!activePlayer;
                        const progress = activePlayer ? (activePlayer.progress / activePlayer.duration) * 100 : 0;
                        const hoverColor = 'hover:bg-neutral-300 dark:hover:bg-neutral-700';

                        return (
                            <div
                                key={index}
                                onDrop={(e) => handleDrop(e, index)}
                                onDragOver={(e) => e.preventDefault()}
                                onContextMenu={(e) => handleContextMenu(e, index)}
                                className={`relative flex flex-col justify-center items-center p-2 rounded-md transition-colors text-center cursor-pointer ${item ? 'text-white' : `text-neutral-400 ${hoverColor}`} ${isPlaying ? 'animate-pulse-cart' : ''}`}
                                style={{ backgroundColor: item?.color || (item ? '#3f3f46' : undefined) }} // zinc-700 fallback
                                onClick={() => item && handlePlay(index)}
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
                                    <PlusIcon className="w-6 h-6"/>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
             {contextMenu && (
                <div ref={contextMenuRef} className="fixed z-30 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-md shadow-lg py-1" style={{ top: contextMenu.y, left: contextMenu.x }}>
                    <button
                        onClick={() => {
                            setColoringIndex(contextMenu.index);
                            colorInputRef.current?.click();
                            setContextMenu(null);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700">
                        Set Color
                    </button>
                    <button
                        onClick={() => setClearConfirm({ page: false, index: contextMenu.index })}
                        className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-neutral-200 dark:hover:bg-neutral-700">
                        Clear Item
                    </button>
                </div>
            )}
             <ConfirmationDialog
                isOpen={clearConfirm.page || clearConfirm.index !== null}
                onClose={() => setClearConfirm({ page: false, index: null })}
                onConfirm={() => {
                    if (clearConfirm.page) handleClearPage();
                    else if (clearConfirm.index !== null) handleClearItem(clearConfirm.index);
                    setClearConfirm({ page: false, index: null });
                }}
                title={clearConfirm.page ? "Clear Cartwall Page" : "Clear Cart Item"}
            >
                Are you sure you want to clear {clearConfirm.page ? "all items from this page" : "this item"}? This cannot be undone.
            </ConfirmationDialog>
            <input type="color" ref={colorInputRef} onChange={handleColorChange} className="absolute invisible" />
        </div>
    );
};

export default React.memo(Cartwall);