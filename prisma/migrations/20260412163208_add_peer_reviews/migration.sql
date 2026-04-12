-- CreateTable
CREATE TABLE "peer_reviews" (
    "id" TEXT NOT NULL,
    "circle_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "reviewee_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" VARCHAR(280),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "peer_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "peer_reviews_circle_id_reviewee_id_idx" ON "peer_reviews"("circle_id", "reviewee_id");

-- CreateIndex
CREATE UNIQUE INDEX "peer_reviews_circle_id_reviewer_id_reviewee_id_key" ON "peer_reviews"("circle_id", "reviewer_id", "reviewee_id");

-- AddForeignKey
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "rosca_circles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_reviewee_id_fkey" FOREIGN KEY ("reviewee_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
