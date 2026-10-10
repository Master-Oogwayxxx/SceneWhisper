import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

interface StatCardProps {
    label: string;
    value: number;
    icon: LucideIcon;
    variant?: 'default' | 'primary' | 'success' | 'warning' | 'destructive';
    /** When set, the card is focusable and opens the task queue (or other action) on activate. */
    onClick?: () => void;
}

const variantStyles = {
    default: 'bg-card border-border',
    primary: 'bg-primary/10 border-primary/20',
    success: 'bg-success/10 border-success/20',
    warning: 'bg-warning/10 border-warning/20',
    destructive: 'bg-destructive/10 border-destructive/20',
};

const iconStyles = {
    default: 'bg-secondary text-foreground',
    primary: 'bg-primary/20 text-primary',
    success: 'bg-success/20 text-success',
    warning: 'bg-warning/20 text-warning',
    destructive: 'bg-destructive/20 text-destructive',
};

const cardClassName = (variant: StatCardProps['variant'], interactive: boolean) =>
    cn(
        'rounded-lg border px-1.5 py-1.5 transition-all duration-300 animate-fade-in sm:rounded-xl sm:p-5',
        interactive ? 'hover:scale-[1.02] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2' : '',
        variantStyles[variant ?? 'default'],
    );

/**
 * Compact metric tile for dashboard statistics.
 * @param props - Label, value, icon, optional variant, and optional click handler
 */
export const StatCard = ({ label, value, icon: Icon, variant = 'default', onClick }: StatCardProps) => {
    const interactive = Boolean(onClick);
    const inner = (
        <div className="block sm:flex sm:items-start sm:justify-between sm:gap-2">
            <div className="min-w-0">
                <p className="mb-0.5 truncate text-[10px] leading-4 text-muted-foreground sm:mb-1 sm:text-sm">{label}</p>
                <p className="text-lg font-bold leading-5 tracking-tight sm:text-3xl sm:leading-none">{value}</p>
            </div>
            <div className={cn('hidden shrink-0 rounded-md p-2 sm:flex sm:rounded-lg sm:p-3', iconStyles[variant])}>
                <Icon className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />
            </div>
        </div>
    );

    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                className={cn('w-full text-left', cardClassName(variant, interactive))}
                aria-label={`Open task queue filtered by ${label}`}
            >
                {inner}
            </button>
        );
    }

    return <div className={cardClassName(variant, false)}>{inner}</div>;
};
