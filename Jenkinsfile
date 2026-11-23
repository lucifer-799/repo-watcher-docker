// Jenkinsfile —— Repo Watcher（Docker 版）构建示例
//
// ⚠️ 本文件是「构建/推送镜像」的参考模板，其中的仓库地址、镜像仓库、HTTP 代理等
//    均为占位示例，请在您的 Jenkins 中按实际环境替换（或改为 Jenkins 凭据/参数注入）。
//    上游原项目不含本文件；本文件由 Docker 版维护者添加。
//
// 依赖：一个提供 Docker 的 agent（label 可改），以及推送镜像所需的凭据（见 credentialsId）。
// 说明：本文件仅描述构建/推送；建 job、触发部署不在其中。

@Library('jenkins-notify') _

pipeline {
    agent { label 'ubuntu' }

    options {
        timestamps()
        timeout(time: 60, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '20'))
        disableConcurrentBuilds()
    }

    parameters {
        string(name: 'VERSION', defaultValue: '1.1.0',
               description: '镜像 tag 版本号（默认 1.1.0）')
    }

    environment {
        // 以下均为示例值，请替换为您的实际地址（或用 Jenkins 参数/凭据注入）
        GITEA_URL   = 'http://git.example.com:3000'
        GITEA_REPO  = 'your-org/repo-watcher-docker'
        GIT_BRANCH  = 'main'
        REGISTRY    = 'registry.example.com'
        IMAGE_NAME  = 'repo-watcher'
        // 构建期出网代理（留空表示不需要）；npm 走该代理
        BUILD_PROXY = ''
        // 直连地址不走代理
        NO_PROXY    = 'localhost,127.0.0.1'
    }

    stages {
        stage('拉取源码') {
            steps {
                script {
                    withCredentials([usernamePassword(credentialsId: 'your-gitea-credential-id',
                                                      usernameVariable: 'GT_USER',
                                                      passwordVariable: 'GT_PASS')]) {
                        sh '''
                            set -eu
                            rm -rf src
                            git clone --depth 1 --branch "$GIT_BRANCH" \
                              "http://$GT_USER:$GT_PASS@${GITEA_URL#http://}/${GITEA_REPO}.git" src
                            git -C src remote set-url origin "${GITEA_URL}/${GITEA_REPO}.git"
                            echo "HEAD=$(git -C src rev-parse --short=7 HEAD) 分支=$GIT_BRANCH"
                        '''
                    }
                }
            }
        }

        stage('构建镜像') {
            steps {
                sh '''
                    set -eu
                    cd src
                    echo "构建 repo-watcher:${VERSION:-1.1.0}（node:22-slim，npm 走代理）"
                    DOCKER_BUILDKIT=0 docker build \
                      --build-arg HTTP_PROXY="$BUILD_PROXY" \
                      --build-arg HTTPS_PROXY="$BUILD_PROXY" \
                      --build-arg NO_PROXY="$NO_PROXY" \
                      --build-arg http_proxy="$BUILD_PROXY" \
                      --build-arg https_proxy="$BUILD_PROXY" \
                      --build-arg no_proxy="$NO_PROXY" \
                      -t "${IMAGE_NAME}:${VERSION:-1.1.0}" \
                      -t "${IMAGE_NAME}:latest" \
                      .
                    docker images "${IMAGE_NAME}" --format '  {{.Repository}}:{{.Tag}} {{.Size}}'
                '''
            }
        }

        stage('推 Nexus') {
            steps {
                script {
                    withCredentials([usernamePassword(credentialsId: 'your-registry-push-credential',
                                                      usernameVariable: 'REG_USER',
                                                      passwordVariable: 'REG_PASS')]) {
                        sh '''
                            set -eu
                            echo "$REG_PASS" | docker login "$REGISTRY" -u "$REG_USER" --password-stdin
                            docker tag "${IMAGE_NAME}:${VERSION:-1.1.0}" "${REGISTRY}/${IMAGE_NAME}:${VERSION:-1.1.0}"
                            docker tag "${IMAGE_NAME}:latest"    "${REGISTRY}/${IMAGE_NAME}:latest"
                            docker push "${REGISTRY}/${IMAGE_NAME}:${VERSION:-1.1.0}"
                            docker push "${REGISTRY}/${IMAGE_NAME}:latest"
                            docker logout "$REGISTRY" || true
                            echo "已推送 ${REGISTRY}/${IMAGE_NAME}:${VERSION:-1.1.0} 与 :latest"
                        '''
                    }
                }
            }
        }
    }

    post {
        success {
            echo "构建成功：${env.REGISTRY}/${env.IMAGE_NAME}:${env.VERSION ?: '1.1.0'}"
        }
        failure {
            echo "构建失败：repo-watcher-docker"
        }
    }
}