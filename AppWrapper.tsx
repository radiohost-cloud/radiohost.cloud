
import React, { useState, useEffect } from 'react';
import App from './App';
import ModeSelector from './components/ModeSelector';

const AppWrapper: React.FC = () => {
    const [mode, setMode] = useState<'HOST' | 'DEMO' | null>(null);

    useEffect(() => {
        const savedMode = sessionStorage.getItem('appMode') as 'HOST' | 'DEMO' | null;
        if (savedMode) {
            setMode(savedMode);
        }
    }, []);

    const handleModeSelect = (selectedMode: 'HOST' | 'DEMO') => {
        sessionStorage.setItem('appMode', selectedMode);
        setMode(selectedMode);
    };

    if (!mode) {
        return <ModeSelector onModeSelect={handleModeSelect} />;
    }

    return <App />;
};

export default AppWrapper;
