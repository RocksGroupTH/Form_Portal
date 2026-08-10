import { redirect } from "next/navigation";

export default function LegacyGoogleMapsSettingsPage() {
  redirect("/settings/maps");
}
