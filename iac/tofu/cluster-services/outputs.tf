output "cluster_endpoint" {
  description = "Endpoint del cluster GKE"
  value       = google_container_cluster.main.endpoint
  sensitive   = true
}

output "kubeconfig_command" {
  description = "Comando para obtener credenciales del cluster"
  value       = "gcloud container clusters get-credentials ${var.cluster_name} --region ${var.region} --project ${var.project_id}"
}
