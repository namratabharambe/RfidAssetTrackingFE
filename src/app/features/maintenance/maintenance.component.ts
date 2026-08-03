import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-maintenance',
  standalone: true,
  imports: [CommonModule],
  template: `<div class="p-6 bg-surface rounded-2xl border border-border shadow-sm"><h2 class="text-xl font-bold text-main">Maintenance & Servicing</h2><p class="text-sm text-muted mt-1">Work orders, technician logs, and repair schedules.</p></div>`
})
export class MaintenanceComponent {}
