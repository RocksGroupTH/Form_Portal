import { redirect } from "next/navigation";

export default function LegacyOrsSettingsPage() {
  redirect("/settings/maps");
}
