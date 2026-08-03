import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-integrations',
  standalone: true,
  imports: [CommonModule],
  template: `<div class="p-6 bg-surface rounded-2xl border border-border shadow-sm"><h2 class="text-xl font-bold text-main">System Integrations</h2><p class="text-sm text-muted mt-1">Connect ERP, SAP, WMS, and IoT hardware gateways.</p></div>`
})
export class IntegrationsComponent {}
