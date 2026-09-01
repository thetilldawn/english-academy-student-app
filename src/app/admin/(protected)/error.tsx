"use client";

import {
  AdminRouteError,
  type AdminRouteErrorProps,
} from "./admin-route-error";

export default function AdminError(props: AdminRouteErrorProps) {
  return <AdminRouteError {...props} />;
}
