

import React from 'react';

interface ResizerProps {
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  onDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  title?: string;
}

const Resizer: React.FC<ResizerProps> = ({ onMouseDown, onDoubleClick, title }) => {
  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      title={title}
      className="flex-shrink-0 w-3 h-full cursor-col-resize group flex items-center justify-center"
    >
        <div className="w-1 h-12 bg-neutral-200 dark:bg-neutral-800 rounded-full transition-all duration-200 ease-in-out group-hover:bg-blue-500 group-active:bg-blue-600 group-hover:scale-y-150 group-active:scale-y-150" />
    </div>
  );
};

export default React.memo(Resizer);