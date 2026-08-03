import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-gps-tracking',
  standalone: true,
  imports: [CommonModule],
  template: `<div class="p-6 bg-surface rounded-2xl border border-border shadow-sm"><h2 class="text-xl font-bold text-main">GPS Live Tracking</h2><p class="text-sm text-muted mt-1">Real-time asset telemetry and geofence tracking map.</p></div>`
})
export class GpsTrackingComponent {}
