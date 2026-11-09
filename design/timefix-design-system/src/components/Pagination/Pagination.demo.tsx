import { useState } from 'react';
import { Pagination } from './Pagination.tsx';

export function PaginationDemo() {
  const [page, setPage] = useState(1);
  const [p2, setP2] = useState(12);
  const [p3, setP3] = useState(1);
  return (
    <div className="tf-demo tf-stack" style={{ gap: 'var(--space-24)' }}>
      <div>
        <p className="tf-demo-label">Table footer, 1,284 companies</p>
        <Pagination page={page} pageSize={50} total={1284} noun="companies" onPageChange={setPage} />
      </div>
      <div>
        <p className="tf-demo-label">Deep in the list</p>
        <Pagination page={p2} pageSize={50} total={1284} noun="companies" onPageChange={setP2} />
      </div>
      <div className="tf-row" style={{ justifyContent: 'space-between' }}>
        <div>
          <p className="tf-demo-label">Compact, 86 responses</p>
          <Pagination variant="compact" page={p3} pageSize={25} total={86} noun="responses" onPageChange={setP3} />
        </div>
        <div>
          <p className="tf-demo-label">Empty</p>
          <Pagination variant="compact" page={1} pageSize={25} total={0} noun="bookings" onPageChange={() => undefined} />
        </div>
      </div>
    </div>
  );
}
