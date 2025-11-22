import type { ViewMode } from '../types/dashboard';

interface ViewToggleProps {
    view: ViewMode;
    onViewChange: (view: ViewMode) => void;
}

export function ViewToggle({ view, onViewChange }: ViewToggleProps) {
    return (
        <div className="view-toggle">
            <button
                className={`toggle-btn ${view === 'overview' ? 'active' : ''}`}
                onClick={() => onViewChange('overview')}
            >
                📊 Overview
            </button>
            <button
                className={`toggle-btn ${view === 'detail' ? 'active' : ''}`}
                onClick={() => onViewChange('detail')}
            >
                🔍 Bot Detail
            </button>
        </div>
    );
}
