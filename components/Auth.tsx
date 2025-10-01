import React, { useState, useEffect } from 'react';
import { GithubIcon } from './icons/GithubIcon';
import { LogoIcon } from './icons/LogoIcon';
import * as dataService from '../services/dataService';
import { type User } from '../types';

interface AuthProps {
    onLogin: (user: User) => void;
    onSignup: (user: User) => void;
}

const Auth: React.FC<AuthProps> = ({ onLogin, onSignup }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [nickname, setNickname] = useState('');
    const [error, setError] = useState('');
    
    useEffect(() => {
        const checkUsers = async () => {
            const users = await dataService.getAllUsers();
            if (users.length === 0) {
                setIsLogin(false);
            }
        };
        checkUsers();
    }, []);


    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!isLogin && !nickname.trim()) {
            setError('Nickname is required.');
            return;
        }

        if (!email || !password) {
            setError('Email and password are required.');
            return;
        }
        if (!/\S+@\S+\.\S+/.test(email)) {
            setError('Please enter a valid email address.');
            return;
        }

        try {
            let user: User | null;

            if (isLogin) {
                user = await dataService.login(email, password);
                if (user) {
                    if (user.role) {
                        sessionStorage.setItem('playoutMode', user.role);
                    }
                    dataService.putAppState('currentUserEmail', email);
                    onLogin(user);
                } else {
                     throw new Error('Invalid email or password.');
                }
            } else { // Signup
                const newUser: User = { email, password, nickname };
                user = await dataService.signup(newUser);
                 if (user) {
                    if (user.role) {
                        sessionStorage.setItem('playoutMode', user.role);
                    }
                    dataService.putAppState('currentUserEmail', email);
                    onSignup(user);
                 } else {
                    throw new Error('An account with this email already exists.');
                 }
            }
        } catch(err) {
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError('An unknown error occurred.');
            }
        }
    };

    return (
        <div className="fixed inset-0 bg-white/80 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="w-full max-w-md p-8 space-y-8 bg-white dark:bg-neutral-900 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-800">
                <div className="text-center">
                    <LogoIcon className="h-12 w-auto text-black dark:text-white inline-block" />
                    <p className="mt-2 text-center text-sm text-neutral-600 dark:text-neutral-400">
                        {isLogin ? 'Sign in to your account' : 'Create a new account'}
                    </p>
                </div>

                <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
                    <div className="rounded-md shadow-sm -space-y-px">
                         {!isLogin && (
                             <div>
                                <label htmlFor="nickname" className="sr-only">Nickname</label>
                                <input
                                    id="nickname"
                                    name="nickname"
                                    type="text"
                                    autoComplete="nickname"
                                    required
                                    value={nickname}
                                    onChange={(e) => setNickname(e.target.value)}
                                    className="appearance-none rounded-none relative block w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black placeholder-neutral-400 dark:placeholder-neutral-500 text-black dark:text-white rounded-t-md focus:outline-none focus:ring-black dark:focus:ring-white focus:border-black dark:focus:border-white focus:z-10 sm:text-sm"
                                    placeholder="Nickname"
                                />
                            </div>
                        )}
                        <div>
                            <label htmlFor="email-address" className="sr-only">Email address</label>
                            <input
                                id="email-address"
                                name="email"
                                type="email"
                                autoComplete="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className={`appearance-none rounded-none relative block w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black placeholder-neutral-400 dark:placeholder-neutral-500 text-black dark:text-white ${isLogin ? 'rounded-t-md' : ''} focus:outline-none focus:ring-black dark:focus:ring-white focus:border-black dark:focus:border-white focus:z-10 sm:text-sm`}
                                placeholder="Email address"
                            />
                        </div>
                        <div>
                            <label htmlFor="password" className="sr-only">Password</label>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                autoComplete="current-password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black placeholder-neutral-400 dark:placeholder-neutral-500 text-black dark:text-white rounded-b-md focus:outline-none focus:ring-black dark:focus:ring-white focus:border-black dark:focus:border-white focus:z-10 sm:text-sm"
                                placeholder="Password"
                            />
                        </div>
                    </div>

                    {error && <p className="text-sm text-red-500 text-center">{error}</p>}

                    <div>
                        <button
                            type="submit"
                            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white dark:text-black bg-black dark:bg-white hover:bg-neutral-800 dark:hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-neutral-900 focus:ring-black dark:focus:ring-white"
                        >
                            {isLogin ? 'Sign In' : 'Sign Up'}
                        </button>
                    </div>
                </form>

                <div className="space-y-4">
                    <p className="text-center text-sm text-neutral-600 dark:text-neutral-500">
                        {isLogin ? "Don't have an account?" : 'Already have an account?'}
                        <button onClick={() => { setIsLogin(!isLogin); setError(''); }} className="font-medium text-black dark:text-white hover:text-neutral-800 dark:hover:text-neutral-300 ml-1">
                            {isLogin ? 'Sign Up' : 'Sign In'}
                        </button>
                    </p>
                </div>
                
                <div className="!mt-4 space-y-3">
                    <p className="text-center text-xs text-neutral-500 dark:text-neutral-600">
                        Need help? Contact us at{' '}
                        <a href="mailto:contact@radiohost.cloud" className="font-medium text-black dark:text-white hover:underline">
                            contact@radiohost.cloud
                        </a>
                    </p>
                    <div className="text-center">
                        <a 
                            href="https://github.com/radiohost-cloud/radiohost.cloud"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block text-neutral-500 dark:text-neutral-400 hover:text-black dark:hover:text-white transition-colors"
                            aria-label="Visit our GitHub page"
                        >
                            <GithubIcon className="w-6 h-6" />
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Auth;