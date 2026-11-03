import React from 'react';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { PageSizeSelect } from './PageSizeSelect';

interface FileBrowserPaginationProps {
    currentPage: number;
    totalPages: number;
    itemsPerPage: number;
    setItemsPerPage: React.Dispatch<React.SetStateAction<number>>;
    setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
    total: number;
    hideItemsPerPageOnMobile?: boolean;
}

export function FileBrowserPagination({
    currentPage,
    totalPages,
    itemsPerPage,
    setItemsPerPage,
    setCurrentPage,
    total,
    hideItemsPerPageOnMobile = false,
}: FileBrowserPaginationProps) {
    if (totalPages < 1) {
        return null;
    }

    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = startPage + maxVisiblePages - 1;

    if (endPage > totalPages) {
        startPage = Math.max(1, totalPages - maxVisiblePages + 1);
        endPage = totalPages;
    }

    const pageNumbers = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);

    return (
        <div className="grid flex-none shrink-0 grid-cols-1 items-center gap-1.5 pt-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-2">
            <div className={`items-center gap-1.5 sm:flex sm:gap-2 ${hideItemsPerPageOnMobile ? 'hidden' : 'flex'}`}>
                <span className="whitespace-nowrap text-xs text-muted-foreground sm:text-sm">Per page:</span>
                <PageSizeSelect value={itemsPerPage} options={[10, 25, 50, 100, 250, 500, 1000]} onChange={(value) => { setItemsPerPage(value); setCurrentPage(1); }} />
            </div>

                <div className="scrollbar -mx-1 flex min-w-0 max-w-full items-center justify-center gap-1 overflow-x-auto px-1 sm:mx-0 sm:justify-self-center sm:gap-2 sm:px-0">
                    <button
                        onClick={() => setCurrentPage(1)}
                        className={`rounded-md border p-1.5 text-xs font-medium sm:p-2 sm:text-sm ${currentPage === 1 ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`}
                        disabled={currentPage === 1}
                        aria-label="First page"
                    >
                        <ChevronFirst className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    </button>

                    <button
                        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                        className={`rounded-md border p-1.5 text-xs font-medium sm:p-2 sm:text-sm ${currentPage === 1 ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`}
                        disabled={currentPage === 1}
                        aria-label="Previous page"
                    >
                        <ChevronLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    </button>

                    {startPage > 1 && (
                        <>
                            <button onClick={() => setCurrentPage(1)} className="rounded-md border bg-transparent px-2 py-1 text-xs font-medium hover:bg-muted sm:px-3 sm:py-1.5 sm:text-sm">1</button>
                            {startPage > 2 && <span className="px-2 py-1 text-xs sm:px-3 sm:py-1.5 sm:text-sm">...</span>}
                        </>
                    )}

                    {pageNumbers.map((page) => (
                        <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className={`rounded-md border px-2 py-1 text-xs font-medium sm:px-3 sm:py-1.5 sm:text-sm ${currentPage === page ? 'bg-primary text-primary-foreground' : 'bg-transparent hover:bg-muted'}`}
                        >
                            {page}
                        </button>
                    ))}

                    {endPage < totalPages && (
                        <>
                            {endPage < totalPages - 1 && <span className="px-2 py-1 text-xs sm:px-3 sm:py-1.5 sm:text-sm">...</span>}
                            <button onClick={() => setCurrentPage(totalPages)} className="rounded-md border bg-transparent px-2 py-1 text-xs font-medium hover:bg-muted sm:px-3 sm:py-1.5 sm:text-sm">{totalPages}</button>
                        </>
                    )}

                    <button
                        onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                        className={`rounded-md border p-1.5 text-xs font-medium sm:p-2 sm:text-sm ${currentPage === totalPages ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`}
                        disabled={currentPage === totalPages}
                        aria-label="Next page"
                    >
                        <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    </button>

                    <button
                        onClick={() => setCurrentPage(totalPages)}
                        className={`rounded-md border p-1.5 text-xs font-medium sm:p-2 sm:text-sm ${currentPage === totalPages ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`}
                        disabled={currentPage === totalPages}
                        aria-label="Last page"
                    >
                        <ChevronLast className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    </button>
                </div>
            <div className="whitespace-nowrap text-center text-[10px] text-muted-foreground sm:text-right sm:text-xs">
                Showing {Math.min((currentPage - 1) * itemsPerPage + 1, total)} – {Math.min(currentPage * itemsPerPage, total)} of {total} files
            </div>
        </div>
    );
}
