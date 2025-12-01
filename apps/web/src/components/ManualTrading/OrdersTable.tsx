import React from 'react';
import type { Order } from '@/types/ManualTrading';

interface OrdersTableProps {
    orders: Order[];
}

/**
 * Orders Table Component
 * Displays list of trading orders
 */
export function OrdersTable({ orders }: OrdersTableProps) {
    if (orders.length === 0) {
        return (
            <div className="rounded border border-slate-800 bg-slate-900/40 px-4 py-6 text-center text-sm text-slate-400">
                Нет активных ордеров
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {orders.map((order) => {
                const statusColor =
                    order.status === 'filled'
                        ? 'bg-emerald-500/15 text-emerald-200'
                        : order.status === 'cancelled'
                            ? 'bg-slate-500/15 text-slate-300'
                            : 'bg-blue-500/15 text-blue-200';

                return (
                    <div
                        key={order.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-900/60 p-3 text-sm"
                    >
                        <div className="flex-1">
                            <p className="font-semibold text-slate-50">{order.instrument}</p>
                            <p className="text-xs text-slate-400">
                                {order.type} · Size: {order.size}
                                {order.price && ` · Price: ${order.price.toLocaleString('ru-RU')}`}
                            </p>
                        </div>
                        <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColor}`}
                        >
                            {order.status === 'active'
                                ? 'Активен'
                                : order.status === 'filled'
                                    ? 'Исполнен'
                                    : 'Отменён'}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}
