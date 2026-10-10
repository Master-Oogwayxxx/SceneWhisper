import { useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2 } from 'lucide-react';

interface BulkProgressDialogProps {
    open: boolean;
    total: number;
    done: number;
    /** Shown while running, e.g. "Deleting tasks… (3 / 10)" */
    runningTitle: string;
    /** Shown when complete */
    doneTitle: string;
    failed?: number;
    cancelling?: boolean;
    onCancel?: () => void;
    onClose: () => void;
    /** Extra content rendered below the progress bar */
    children?: React.ReactNode;
}

export function BulkProgressDialog({
    open,
    total,
    done,
    runningTitle,
    doneTitle,
    failed = 0,
    cancelling,
    onCancel,
    onClose,
    children,
}: BulkProgressDialogProps) {
    const isRunning = done < total;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);

    useEffect(() => {
        if (!open || isRunning || cancelling) return;
        const id = setTimeout(onClose, 750);
        return () => clearTimeout(id);
    }, [open, isRunning, cancelling, onClose]);

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v && !isRunning && !cancelling) onClose(); }}>
            <DialogContent className="sm:max-w-md [&>button:last-of-type]:hidden">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {(isRunning || cancelling) && <Loader2 className="w-4 h-4 animate-spin" />}
                        {isRunning || cancelling ? runningTitle : doneTitle}
                    </DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-4 py-2">
                    <Progress value={percent} className="h-2" />
                    {children}
                    {!isRunning && failed > 0 && (
                        <p className="text-sm text-destructive">
                            {failed} item{failed !== 1 ? 's' : ''} failed.
                        </p>
                    )}
                    {cancelling && (
                        <p className="text-sm text-muted-foreground">
                            Cancelling — waiting for current item to finish…
                        </p>
                    )}
                </div>

                <DialogFooter>
                    {isRunning && !cancelling && onCancel && (
                        <Button variant="outline" onClick={onCancel}>Cancel</Button>
                    )}
                    {!isRunning && !cancelling && (
                        <Button onClick={onClose}>Close</Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
