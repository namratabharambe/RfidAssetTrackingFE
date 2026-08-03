import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-rfid-operations',
  standalone: true,
  imports: [CommonModule],
  template: `<div class="p-6 bg-surface rounded-2xl border border-border shadow-sm"><h2 class="text-xl font-bold text-main">RFID Operations</h2><p class="text-sm text-muted mt-1">Live scan monitor, fixed reader status, and tag management.</p></div>`
})
export class RfidOperationsComponent {}
