// Copyright 2025 Jearhe
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import type { ReactNode } from "react";

import { FormModal as AdapterFormModal } from "../../ui/FormModal.tsx";
import { Icon } from "../ui.tsx";

export interface FormModalProps {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: string | undefined;
  children?: ReactNode;
  onClose?: (() => void) | undefined;
  onSubmit?: (() => void | Promise<unknown>) | undefined;
  submitText?: string | undefined;
  cancelText?: string | undefined;
  busy?: boolean | undefined;
  showSubmit?: boolean | undefined;
}

export function FormModal({ icon = "edit", ...props }: FormModalProps) {
  return <AdapterFormModal {...props} className="system-modal-card" bodyClassName="system-modal-body" icon={<Icon name={icon} size={18} />} />;
}
