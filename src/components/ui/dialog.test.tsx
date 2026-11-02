import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

describe("Dialog without Radix Presence while closed", () => {
  it("renders nothing while closed and shows content while open", () => {
    const { rerender } = render(
      <Dialog open={false}><DialogContent><DialogTitle>Sync</DialogTitle></DialogContent></Dialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<Dialog open><DialogContent><DialogTitle>Sync</DialogTitle></DialogContent></Dialog>);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes through the close button and calls onOpenChange(false)", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>Orders</DialogTitle></DialogContent></Dialog>;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("works uncontrolled with a trigger", () => {
    render(<Dialog><DialogTrigger>Open</DialogTrigger><DialogContent><DialogTitle>Guest</DialogTitle></DialogContent></Dialog>);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("survives rapid open/close toggles without an update loop", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen((o) => !o)}>toggle</button>
          <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>Pay</DialogTitle></DialogContent></Dialog>
        </>
      );
    }
    render(<Harness />);
    act(() => { for (let i = 0; i < 60; i++) fireEvent.click(screen.getByText("toggle", { selector: "button" })); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Popover without Radix Presence while closed", () => {
  it("renders nothing while closed and opens from the trigger", () => {
    render(<Popover><PopoverTrigger>Pick</PopoverTrigger><PopoverContent>Choices</PopoverContent></Popover>);
    expect(screen.queryByText("Choices")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    expect(screen.getByText("Choices")).toBeInTheDocument();
  });
});
