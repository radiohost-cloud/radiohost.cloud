import React from 'react';

export const LogoIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 450 60" xmlns="http://www.w3.org/2000/svg" {...props}>
    <text
      x="50%"
      y="45"
      textAnchor="middle"
      fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol'"
      fontSize="48"
      fontWeight="bold"
      fill="currentColor"
      letterSpacing="-1"
    >
      radiohost<tspan fill="#ef4444">.</tspan>cloud
    </text>
  </svg>
);