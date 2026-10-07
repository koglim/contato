import type { Meta, StoryObj } from "@storybook/react";
import React, { useState } from "react";
import { Pagination } from "./Pagination";

const meta: Meta<typeof Pagination> = {
  title: "Components/Pagination",
  component: Pagination,
};

export default meta;
type Story = StoryObj<typeof Pagination>;

function PaginationDemo() {
  const [page, setPage] = useState(1);
  return (
    <div style={{ maxWidth: 440 }}>
      <Pagination currentPage={page} totalPages={5} onPageChange={setPage} />
    </div>
  );
}

export const Default: Story = {
  render: () => <PaginationDemo />,
};
