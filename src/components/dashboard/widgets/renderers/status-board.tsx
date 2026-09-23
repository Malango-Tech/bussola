import { StatusList } from "@/components/dashboard/widgets/status-list";
import { NoData } from "@/components/dashboard/widgets/widget-messages";
import type { RenderersFor } from "./types";

export const statusBoardRenderers: RenderersFor<"status-board"> = {
  "status-board": (data) => {
    const items = data.items || [];
    if (items.length === 0) {
      return <NoData label="No status items from connected sources." />;
    }
    return <StatusList items={items} showSourceIcon />;
  },
};
