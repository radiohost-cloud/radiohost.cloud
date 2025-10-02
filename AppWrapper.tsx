import React, { useState, useEffect } from 'react';
import App from './App';

const AppWrapper: React.FC = () => {
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        // Force HOST mode as DEMO mode is removed.
        sessionStorage.setItem('appMode', 'HOST');
        setIsReady(true);
    }, []);

    if (!isReady) {
        return null; // Render nothing until mode is set
    }

    return <App />;
};

export default AppWrapper;