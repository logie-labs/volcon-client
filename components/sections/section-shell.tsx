"use client";

import { AnimatePresence, motion } from "framer-motion";
import { sections, SectionKey } from "./index";

interface Props {
  active: SectionKey;
}

export function SectionShell({ active }: Props) {
  const Active = sections[active] ?? sections.mapping;

  return (
    <div className="flex-1 relative overflow-hidden">
      <AnimatePresence>
        <motion.div
          key={active}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.1 }}
          className="absolute inset-0"
        >
          <Active />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}