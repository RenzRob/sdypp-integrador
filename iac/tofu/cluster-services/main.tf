data "google_client_config" "default" {}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "kubernetes" {
  host  = "https://${google_container_cluster.main.endpoint}"
  token = data.google_client_config.default.access_token
  cluster_ca_certificate = base64decode(
    google_container_cluster.main.master_auth[0].cluster_ca_certificate
  )
}

provider "helm" {
  kubernetes {
    host  = "https://${google_container_cluster.main.endpoint}"
    token = data.google_client_config.default.access_token
    cluster_ca_certificate = base64decode(
      google_container_cluster.main.master_auth[0].cluster_ca_certificate
    )
  }
}

# ── GKE cluster ──────────────────────────────────────────────────────────────

resource "google_container_cluster" "main" {
  name     = var.cluster_name
  location = var.region
  project  = var.project_id

  remove_default_node_pool = true
  initial_node_count       = 1

  network    = "default"
  subnetwork = "default"

  release_channel {
    channel = "REGULAR"
  }

  deletion_protection = false
}

resource "google_container_node_pool" "main" {
  name     = "${var.cluster_name}-nodes"
  cluster  = google_container_cluster.main.id
  location = var.region

  # 1 nodo por zona → 3 nodos en total (us-central1-a/b/f)
  node_locations = ["us-central1-a", "us-central1-b", "us-central1-f"]
  node_count     = 1

  node_config {
    machine_type = "e2-medium"
    disk_size_gb = 20
    preemptible  = false
    oauth_scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }
}

# ── ingress-nginx (controller v1.15.1) ───────────────────────────────────────

resource "helm_release" "ingress_nginx" {
  name             = "ingress-nginx"
  repository       = "https://kubernetes.github.io/ingress-nginx"
  chart            = "ingress-nginx"
  namespace        = "ingress-nginx"
  create_namespace = true

  set {
    name  = "controller.image.tag"
    value = "v1.15.1"
  }

  depends_on = [google_container_node_pool.main]
}

# ── cert-manager (v1.20.2) ───────────────────────────────────────────────────

resource "helm_release" "cert_manager" {
  name             = "cert-manager"
  repository       = "https://charts.jetstack.io"
  chart            = "cert-manager"
  version          = "v1.20.2"
  namespace        = "cert-manager"
  create_namespace = true

  set {
    name  = "crds.enabled"
    value = "true"
  }

  depends_on = [google_container_node_pool.main]
}
