"use client";

import { useEffect, useId, useRef, useState } from "react";

type Option = { value: string; label: string };

export function Dropdown({ label, placeholder, options, value, onChange, compact = false }: {
  label: string; placeholder: string; options: Option[]; value?: string;
  onChange: (value: string) => void; compact?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const firstFocus = useRef(0);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    list.current?.querySelectorAll<HTMLButtonElement>("button")[firstFocus.current]?.focus();
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const show = (index = Math.max(0, options.findIndex((option) => option.value === value))) => {
    firstFocus.current = index;
    setOpen(true);
  };

  return <div className={`dropdown${compact ? " compact" : ""}`} ref={root}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={(event) => {
      if (!open || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    }}>
    <button type="button" className="dropdown-trigger" ref={trigger}
      aria-label={selected ? `${label}: ${selected.label}` : label}
      aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? id : undefined}
      disabled={!options.length} onClick={() => open ? setOpen(false) : show()}
      onKeyDown={(event) => {
        if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          show(event.key === "ArrowUp" ? options.length - 1 : undefined);
        }
      }}>
      <span>{selected?.label ?? placeholder}</span><span className="dropdown-chevron" aria-hidden="true" />
    </button>
    {open && <div className="dropdown-options" id={id} role="listbox" aria-label={label} ref={list}
      onKeyDown={(event) => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
          (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
        buttons[next]?.focus();
      }}>
      {options.map((option) => <button type="button" key={option.value} role="option"
        aria-selected={option.value === value} tabIndex={-1} onClick={() => { onChange(option.value); close(); }}>
        {option.label}
      </button>)}
    </div>}
  </div>;
}
