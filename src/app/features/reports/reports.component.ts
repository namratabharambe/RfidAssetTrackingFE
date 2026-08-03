import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule],
  template: `<div class="p-6 bg-surface rounded-2xl border border-border shadow-sm"><h2 class="text-xl font-bold text-main">Reports & Analytics</h2><p class="text-sm text-muted mt-1">Operational analytics, scheduled email reports, and data exports.</p></div>`
})
export class ReportsComponent {}
