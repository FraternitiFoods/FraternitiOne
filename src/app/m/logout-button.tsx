import { logoutSupervisor } from "./actions";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  return (
    <form action={logoutSupervisor}>
      <Button type="submit" variant="ghost" size="sm">
        Sign out
      </Button>
    </form>
  );
}
