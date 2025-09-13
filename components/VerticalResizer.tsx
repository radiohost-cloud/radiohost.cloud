import React from 'react';

interface VerticalResizerProps {
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  onDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  title?: string;
}

const VerticalResizer: React.FC<VerticalResizerProps> = ({ onMouseDown, onDoubleClick, title }) => {
  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      title={title}
      className="flex-shrink-0 h-3 w-full cursor-row-resize group flex items-center justify-center"
    >
        <div className="h-1 w-12 bg-neutral-200 dark:bg-neutral-800 rounded-full transition-all duration-200 ease-in-out group-hover:bg-blue-500 group-active:bg-blue-600 group-hover:scale-x-150 group-active:scale-x-150" />
    </div>
  );
};

export default React.memo(VerticalResizer);
