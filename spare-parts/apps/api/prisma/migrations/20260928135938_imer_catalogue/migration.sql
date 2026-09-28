-- AlterTable
ALTER TABLE "assemblies" ADD COLUMN     "notes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "equipment" ADD COLUMN     "copied_from_id" INTEGER,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "serial_number" TEXT;

-- AlterTable
ALTER TABLE "part_usages" ADD COLUMN     "position" TEXT;

-- CreateTable
CREATE TABLE "assembly_info_lines" (
    "id" SERIAL NOT NULL,
    "assembly_id" INTEGER NOT NULL,
    "position" TEXT,
    "description" TEXT NOT NULL,
    "quantity_raw" TEXT,
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "source_record_id" INTEGER,

    CONSTRAINT "assembly_info_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assembly_info_lines_source_record_id_key" ON "assembly_info_lines"("source_record_id");

-- CreateIndex
CREATE INDEX "assembly_info_lines_assembly_id_idx" ON "assembly_info_lines"("assembly_id");

-- AddForeignKey
ALTER TABLE "assembly_info_lines" ADD CONSTRAINT "assembly_info_lines_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_info_lines" ADD CONSTRAINT "assembly_info_lines_source_record_id_fkey" FOREIGN KEY ("source_record_id") REFERENCES "source_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
